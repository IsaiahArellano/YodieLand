import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("YODIELAND_DATA_DIR", str(ROOT.parent / "YodieLand-private")))
DATA_FILE = DATA_DIR / "data.json"
PERMISSIONS_FILE = DATA_DIR / "permissions.json"
LEGACY_DATA_FILE = ROOT / "yodieland-data.json"
STAFF_SIGNUP_CODE = os.environ.get("STAFF_SIGNUP_CODE", "")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"
SESSION_LIFETIME = 12 * 60 * 60
COPY_KEYS = {"heroTitle", "intro", "note", "jobs", "status", "archive", "request", "footer"}
CATEGORIES = {"memories", "reunions", "club-notes"}
DATA_LOCK = threading.RLock()
SESSION_LOCK = threading.RLock()
SESSIONS = {}
AUTH_ATTEMPTS = {}
DEFAULT_PERMISSIONS = {
    "roles": {
        "member": {"post_thread": False, "post_job": False, "reply": False, "revise_board": False, "edit_copy": False, "manage_permissions": False},
        "staff": {"post_thread": True, "post_job": True, "reply": True, "revise_board": True, "edit_copy": True, "manage_permissions": True},
    }
}


def empty_data():
    return {
        "threads": [],
        "jobs": [],
        "copy": {key: "" for key in COPY_KEYS},
        "members": [],
    }


def read_data():
    with DATA_LOCK:
        if not DATA_FILE.exists():
            data = empty_data()
            if LEGACY_DATA_FILE.exists():
                try:
                    legacy = json.loads(LEGACY_DATA_FILE.read_text(encoding="utf-8"))
                    for key in ("threads", "jobs", "copy"):
                        if isinstance(legacy.get(key), type(data[key])):
                            data[key] = legacy[key]
                    LEGACY_DATA_FILE.unlink()
                except (OSError, json.JSONDecodeError):
                    pass
            write_data(data)
        try:
            data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = empty_data()
        for key, value in empty_data().items():
            if key not in data or not isinstance(data[key], type(value)):
                data[key] = value
        return data


def write_data(data):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary_file = DATA_FILE.with_suffix(".tmp")
    temporary_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary_file.replace(DATA_FILE)


class AuthenticationRequired(Exception):
    pass


class StaffRequired(Exception):
    pass


class RateLimitExceeded(Exception):
    pass


def public_member(member):
    result = {key: member[key] for key in ("id", "name", "email", "role")}
    result["permissions"] = role_permissions().get(member["role"], {})
    return result


def role_permissions():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not PERMISSIONS_FILE.exists():
        PERMISSIONS_FILE.write_text(json.dumps(DEFAULT_PERMISSIONS, indent=2), encoding="utf-8")
    try:
        roles = json.loads(PERMISSIONS_FILE.read_text(encoding="utf-8")).get("roles", {})
    except (OSError, json.JSONDecodeError, AttributeError):
        return {}
    if not isinstance(roles, dict):
        return {}
    normalized = {}
    for role, defaults in DEFAULT_PERMISSIONS["roles"].items():
        configured = roles.get(role)
        role_is_valid = isinstance(configured, dict)
        if not role_is_valid:
            configured = {}
        normalized[role] = {
            permission: configured[permission] is True if permission in configured else default and role_is_valid
            for permission, default in defaults.items()
        }
    if normalized != roles:
        PERMISSIONS_FILE.write_text(json.dumps({"roles": normalized}, indent=2), encoding="utf-8")
    return normalized


def hash_password(password):
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise ValueError("Password must be between 12 and 128 characters.")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64, maxmem=64 * 1024 * 1024)
    return f"{salt.hex()}:{digest.hex()}"


def check_password(password, stored_hash):
    try:
        salt_hex, digest_hex = stored_hash.split(":", 1)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=64, maxmem=64 * 1024 * 1024)
    except (AttributeError, ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def new_session(member):
    token = secrets.token_urlsafe(32)
    expires = int(time.time()) + SESSION_LIFETIME
    with SESSION_LOCK:
        SESSIONS[token] = {"member": public_member(member), "expires": expires}
    cookie = f"yodie_session={token}; Path=/; Max-Age={SESSION_LIFETIME}; HttpOnly; SameSite=Strict"
    if COOKIE_SECURE:
        cookie += "; Secure"
    return cookie


def expire_session_cookie():
    cookie = "yodie_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
    return cookie + ("; Secure" if COOKIE_SECURE else "")


def require_text(value, field, limit, required=True):
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text.")
    value = value.strip()
    if required and not value:
        raise ValueError(f"{field} is required.")
    if len(value) > limit:
        raise ValueError(f"{field} is too long.")
    return value


class YodieLandHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format_string, *args):
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def send_json(self, status, payload, headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid request length.") from error
        if size <= 0 or size > 65536:
            raise ValueError("Request must be between 1 byte and 64 KB.")
        try:
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Request body must be valid JSON.") from error
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def current_member(self):
        match = re.search(r"(?:^|;\s*)yodie_session=([A-Za-z0-9_-]+)(?:;|$)", self.headers.get("Cookie", ""))
        if match is None:
            return None
        token = match.group(1)
        with SESSION_LOCK:
            session = SESSIONS.get(token)
            if session and session["expires"] > int(time.time()):
                member = dict(session["member"])
                member["permissions"] = role_permissions().get(member["role"], {})
                return member
            SESSIONS.pop(token, None)
        return None

    def require_permission(self, permission):
        member = self.current_member()
        if member is None:
            raise AuthenticationRequired("Sign in to continue.")
        if not role_permissions().get(member["role"], {}).get(permission, False):
            raise StaffRequired("Your account does not have permission for this action.")
        return member

    def check_auth_rate(self):
        now = time.time()
        address = self.client_address[0]
        with SESSION_LOCK:
            attempts = [stamp for stamp in AUTH_ATTEMPTS.get(address, []) if now - stamp < 900]
            if len(attempts) >= 10:
                raise RateLimitExceeded("Too many account attempts. Try again in 15 minutes.")
            attempts.append(now)
            AUTH_ATTEMPTS[address] = attempts

    def check_same_origin(self):
        origin = self.headers.get("Origin")
        if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get("Host"):
            raise StaffRequired("Cross-origin requests are not allowed.")

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/board":
            data = read_data()
            self.send_json(200, {key: data[key] for key in ("threads", "jobs", "copy")})
            return
        if path == "/api/session":
            self.send_json(200, {"member": self.current_member()})
            return
        if path == "/api/permissions":
            try:
                self.require_permission("manage_permissions")
                self.send_json(200, {"roles": role_permissions()})
            except AuthenticationRequired as error:
                self.send_json(401, {"error": str(error)})
            except StaffRequired as error:
                self.send_json(403, {"error": str(error)})
            return
        if path == "/yodieland-data.json":
            self.send_error(404)
            return
        if path == "/":
            self.path = "/YodieLand.html"
        super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path.rstrip("/")
        try:
            payload = self.read_json()
            if path in {"/api/signup", "/api/login"}:
                self.check_same_origin()
                self.check_auth_rate()
                if path == "/api/signup":
                    member, cookie = self.create_member(payload)
                    self.send_json(201, {"member": public_member(member)}, {"Set-Cookie": cookie})
                else:
                    member, cookie = self.login_member(payload)
                    self.send_json(200, {"member": public_member(member)}, {"Set-Cookie": cookie})
                return
            if path == "/api/logout":
                self.check_same_origin()
                self.destroy_session()
                self.send_json(200, {"ok": True}, {"Set-Cookie": expire_session_cookie()})
                return

            self.check_same_origin()
            if path == "/api/threads":
                permission = "post_thread"
            elif path == "/api/jobs":
                permission = "post_job"
            elif re.fullmatch(r"/api/threads/[^/]+/replies", path):
                permission = "reply"
            else:
                self.send_json(404, {"error": "Unknown endpoint."})
                return
            member = self.require_permission(permission)
            email = member["email"]
            data = read_data()
            now = datetime.now(timezone.utc).isoformat()
            if path == "/api/threads":
                category = payload.get("category", "memories")
                if not isinstance(category, str) or category not in CATEGORIES:
                    raise ValueError("Choose a valid thread channel.")
                thread = {
                    "id": str(uuid.uuid4()),
                    "title": require_text(payload.get("title"), "Subject", 100),
                    "author": require_text(payload.get("author"), "Author", 48),
                    "category": category,
                    "body": require_text(payload.get("body"), "Message", 1800),
                    "createdAt": now,
                    "updatedAt": now,
                    "updatedBy": email,
                    "replies": [],
                }
                data["threads"].append(thread)
                self.save_and_reply(data, 201, thread)
                return

            if path == "/api/jobs":
                job = {
                    "id": str(uuid.uuid4()),
                    "title": require_text(payload.get("title"), "Role", 100),
                    "organization": require_text(payload.get("organization"), "Organization", 80),
                    "location": require_text(payload.get("location", ""), "Location", 80, required=False),
                    "body": require_text(payload.get("body"), "Details", 1200),
                    "contact": require_text(payload.get("contact"), "Contact", 120),
                    "createdAt": now,
                    "updatedAt": now,
                    "updatedBy": email,
                }
                data["jobs"].append(job)
                self.save_and_reply(data, 201, job)
                return

            match = re.fullmatch(r"/api/threads/([^/]+)/replies", path)
            if match:
                thread = next((item for item in data["threads"] if item["id"] == match.group(1)), None)
                if thread is None:
                    self.send_json(404, {"error": "Thread not found."})
                    return
                reply = {
                    "author": require_text(payload.get("author"), "Author", 48),
                    "body": require_text(payload.get("body"), "Reply", 600),
                    "createdAt": now,
                    "updatedBy": email,
                }
                thread.setdefault("replies", []).append(reply)
                thread["updatedAt"] = now
                self.save_and_reply(data, 201, reply)
                return

            self.send_json(404, {"error": "Unknown endpoint."})
        except AuthenticationRequired as error:
            self.send_json(401, {"error": str(error)})
        except StaffRequired as error:
            self.send_json(403, {"error": str(error)})
        except RateLimitExceeded as error:
            self.send_json(429, {"error": str(error)})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})

    def create_member(self, payload):
        name = require_text(payload.get("name"), "Display name", 48)
        email = require_text(payload.get("email"), "Email", 120).lower()
        if not re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}", email):
            raise ValueError("Enter a valid email address.")
        password_hash = hash_password(payload.get("password"))
        staff_code = payload.get("staff_code", "")
        if not isinstance(staff_code, str) or len(staff_code) > 128:
            raise ValueError("Staff invite code is invalid.")
        role = "member"
        if staff_code:
            if not STAFF_SIGNUP_CODE or not hmac.compare_digest(staff_code, STAFF_SIGNUP_CODE):
                raise StaffRequired("Staff invite code is invalid or not configured.")
            role = "staff"
        with DATA_LOCK:
            data = read_data()
            if any(account["email"] == email for account in data["members"]):
                raise ValueError("An account already uses this email.")
            member = {
                "id": str(uuid.uuid4()),
                "name": name,
                "email": email,
                "passwordHash": password_hash,
                "role": role,
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }
            data["members"].append(member)
            write_data(data)
        return member, new_session(member)

    def login_member(self, payload):
        email = require_text(payload.get("email"), "Email", 120).lower()
        password = payload.get("password")
        if not isinstance(password, str):
            raise AuthenticationRequired("Email or password is incorrect.")
        with DATA_LOCK:
            data = read_data()
            member = next((account for account in data["members"] if account["email"] == email), None)
        if member is None or not check_password(password, member.get("passwordHash")):
            raise AuthenticationRequired("Email or password is incorrect.")
        return member, new_session(member)

    def destroy_session(self):
        match = re.search(r"(?:^|;\s*)yodie_session=([A-Za-z0-9_-]+)(?:;|$)", self.headers.get("Cookie", ""))
        if match is not None:
            with SESSION_LOCK:
                SESSIONS.pop(match.group(1), None)

    def do_PUT(self):
        path = urllib.parse.urlsplit(self.path).path.rstrip("/")
        try:
            self.check_same_origin()
            if path == "/api/copy":
                permission = "edit_copy"
            elif path == "/api/permissions":
                permission = "manage_permissions"
            elif re.fullmatch(r"/api/(threads|jobs)/[^/]+", path):
                permission = "revise_board"
            else:
                self.send_json(404, {"error": "Unknown endpoint."})
                return
            member = self.require_permission(permission)
            email = member["email"]
            payload = self.read_json()
            data = read_data()
            now = datetime.now(timezone.utc).isoformat()

            if path == "/api/permissions":
                incoming = payload.get("roles")
                role_names = {"member", "staff"}
                permission_names = set(DEFAULT_PERMISSIONS["roles"]["member"])
                if not isinstance(incoming, dict) or set(incoming) != role_names:
                    raise ValueError("Both member and staff permissions are required.")
                clean_roles = {}
                for role in role_names:
                    rights = incoming[role]
                    if not isinstance(rights, dict) or set(rights) != permission_names or any(type(value) is not bool for value in rights.values()):
                        raise ValueError(f"Invalid permissions for {role}.")
                    clean_roles[role] = rights
                PERMISSIONS_FILE.write_text(json.dumps({"roles": clean_roles}, indent=2), encoding="utf-8")
                self.send_json(200, {"roles": clean_roles})
                return

            if path == "/api/copy":
                incoming = payload.get("copy")
                if not isinstance(incoming, dict) or set(incoming) - COPY_KEYS:
                    raise ValueError("Copy payload is invalid.")
                for key in COPY_KEYS:
                    data["copy"][key] = require_text(incoming.get(key, ""), key, 1000, required=False)
                data["copyUpdatedAt"] = now
                data["copyUpdatedBy"] = email
                self.save_and_reply(data, 200, data["copy"])
                return

            thread_match = re.fullmatch(r"/api/threads/([^/]+)", path)
            job_match = re.fullmatch(r"/api/jobs/([^/]+)", path)
            collection, match = ("threads", thread_match) if thread_match else ("jobs", job_match)
            if match:
                item = next((entry for entry in data[collection] if entry["id"] == match.group(1)), None)
                if item is None:
                    self.send_json(404, {"error": "Listing not found."})
                    return
                fields = {"title": 100, "body": 1800 if collection == "threads" else 1200}
                if collection == "threads":
                    fields.update({"author": 48})
                    category = payload.get("category", item["category"])
                    if not isinstance(category, str) or category not in CATEGORIES:
                        raise ValueError("Choose a valid thread channel.")
                    item["category"] = category
                else:
                    fields.update({"organization": 80, "location": 80, "contact": 120})
                for field, limit in fields.items():
                    if field in payload:
                        item[field] = require_text(payload[field], field, limit, required=(field != "location"))
                item["updatedAt"] = now
                item["updatedBy"] = email
                self.save_and_reply(data, 200, item)
                return

            self.send_json(404, {"error": "Unknown endpoint."})
        except AuthenticationRequired as error:
            self.send_json(401, {"error": str(error)})
        except StaffRequired as error:
            self.send_json(403, {"error": str(error)})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})

    def save_and_reply(self, data, status, payload):
        with DATA_LOCK:
            write_data(data)
        self.send_json(status, payload)


if __name__ == "__main__":
    role_permissions()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8765"))
    print(f"YodieLand preview: http://localhost:{port}")
    print(f"Staff signup: {'enabled' if STAFF_SIGNUP_CODE else 'disabled (set STAFF_SIGNUP_CODE)'}")
    print(f"Role permissions: {PERMISSIONS_FILE}")
    ThreadingHTTPServer((host, port), YodieLandHandler).serve_forever()
