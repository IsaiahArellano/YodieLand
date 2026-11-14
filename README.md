# YodieLand

A public read-only community board with member accounts and server-controlled staff permissions.

Repository: https://github.com/IsaiahArellano/YodieLand

## Run locally

Run `python server.py` from this folder, then open http://localhost:8765. The member sign-up/sign-in page is linked from the ASCII navigation and the [ ACCOUNT ] button.

New accounts are read-only by default. To create staff accounts, set a private `STAFF_SIGNUP_CODE` environment variable before starting the server. Staff enter that invite code during sign-up. Never commit the code.

Signed-in staff with `manage_permissions` can open [ RIGHTS ] to toggle posting, replies, revisions, copy editing, and rights management by role. The server validates each change.

## Deploy

This project includes a Python API and account server. GitHub Pages only serves static files and cannot run the API. Use this repository as source for a Python or Docker host, configure persistent storage through `YODIELAND_DATA_DIR`, set `COOKIE_SECURE=1`, configure `STAFF_SIGNUP_CODE`, and use HTTPS. The Dockerfile binds to `0.0.0.0` and uses port 10000.

Account and role data are stored outside the static web root in `YodieLand-private`. Keep that directory private and backed up. Do not commit it. The `.gitignore` excludes local data and Python cache files.
