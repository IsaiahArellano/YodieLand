async function accountApi(path, method = "GET", payload = null) {
  const headers = {};
  if (payload !== null) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method,
    headers,
    body: payload === null ? undefined : JSON.stringify(payload),
    credentials: "same-origin",
    cache: "no-store"
  });
  let result = {};
  try { result = await response.json(); } catch { result = { error: `Invalid response (${response.status}).` }; }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function showAccountStatus(message, isError = false) {
  const status = document.querySelector("#account-status");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
  status.hidden = false;
}

function showAccount(member) {
  const signedIn = Boolean(member);
  document.querySelector("#account-forms").hidden = signedIn;
  document.querySelector(".account-tabs").hidden = signedIn;
  document.querySelector("#account-session").hidden = !signedIn;
  if (member) {
    document.querySelector("#account-member-name").textContent = `[ ${member.role.toUpperCase()} ] ${member.name}`;
    document.querySelector("#account-member-email").textContent = member.email;
  }
}

function setAccountForm(mode) {
  const login = mode === "login";
  document.querySelector("#login-form").hidden = !login;
  document.querySelector("#signup-form").hidden = login;
  document.querySelector("#show-login").classList.toggle("is-selected", login);
  document.querySelector("#show-signup").classList.toggle("is-selected", !login);
}

async function submitAccountForm(form, path) {
  const submitButton = form.querySelector("button[type=submit]");
  submitButton.disabled = true;
  try {
    const result = await accountApi(path, "POST", Object.fromEntries(new FormData(form)));
    form.reset();
    showAccount(result.member);
    showAccountStatus(`[ ${result.member.role.toUpperCase()} ACCOUNT READY ]`);
  } catch (error) {
    showAccountStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
}

document.querySelector("#show-login").addEventListener("click", () => setAccountForm("login"));
document.querySelector("#show-signup").addEventListener("click", () => setAccountForm("signup"));
document.querySelector("#login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitAccountForm(event.currentTarget, "/api/login");
});
document.querySelector("#signup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitAccountForm(event.currentTarget, "/api/signup");
});
document.querySelector("#account-sign-out").addEventListener("click", async () => {
  try {
    await accountApi("/api/logout", "POST", {});
    showAccount(null);
    setAccountForm("login");
    showAccountStatus("[ SIGNED OUT ]");
  } catch (error) {
    showAccountStatus(error.message, true);
  }
});

accountApi("/api/session").then((result) => showAccount(result.member)).catch((error) => showAccountStatus(error.message, true));
