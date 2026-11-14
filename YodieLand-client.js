const copyKeys = ["heroTitle", "intro", "note", "jobs", "status", "archive", "request", "footer"];
let board = { threads: [], jobs: [], copy: {} };
let member = null;
let editingThreadId = null;
let editingJobId = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function hasPermission(permission) {
  return member?.permissions?.[permission] === true;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function setStatus(selector, message, isError = false) {
  const element = document.querySelector(selector);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", isError);
  element.hidden = false;
}

function setAuthStatus(message, isError = false) {
  const status = document.querySelector("#auth-status");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
  status.hidden = false;
}

async function api(path, method = "GET", payload = null) {
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
  if (!response.ok) {
    if (response.status === 401 && !["/api/login", "/api/signup"].includes(path)) setMember(null);
    throw new Error(result.error || `Request failed (${response.status}).`);
  }
  return result;
}

function setMember(nextMember) {
  member = nextMember;
  if (!hasPermission("post_thread") && !hasPermission("revise_board")) document.querySelector("#topic-form").hidden = true;
  if (!hasPermission("post_job") && !hasPermission("revise_board")) document.querySelector("#job-form").hidden = true;
  document.querySelectorAll(".staff-control").forEach((control) => {
    control.hidden = !hasPermission(control.dataset.permission);
  });
  const permissionsPanel = document.querySelector("#permissions-panel");
  if (permissionsPanel && !hasPermission("manage_permissions")) permissionsPanel.hidden = true;
  document.querySelectorAll(".copy-field").forEach((field) => {
    field.readOnly = !hasPermission("edit_copy");
  });
  const memberName = document.querySelector("#member-name");
  if (memberName) {
    memberName.hidden = !member;
    memberName.textContent = member ? `[ ${member.role.toUpperCase()} ] ${member.name}` : "";
  }
  const signOutButton = document.querySelector("#member-sign-out");
  if (signOutButton) signOutButton.hidden = !member;
  renderThreads();
  renderJobs();
}

function loadCopy(copy) {
  board.copy = copy || {};
  document.querySelectorAll(".copy-field[data-copy]").forEach((field) => {
    field.value = board.copy[field.dataset.copy] || "";
  });
}

function renderThreads() {
  const filter = document.querySelector("#topic-filter").value;
  const threads = [...board.threads].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .filter((thread) => filter === "all" || thread.category === filter);
  document.querySelector("#thread-list").innerHTML = threads.map((thread) => {
    const replies = (thread.replies || []).map((reply) => `<div class="reply-item"><b>${escapeHtml(reply.author)}:</b> ${escapeHtml(reply.body)}</div>`).join("");
    const actions = [
      hasPermission("reply") ? `<button class="quiet-button" data-action="reply" type="button">[ REPLY ]</button>` : "",
      hasPermission("revise_board") ? `<button class="quiet-button" data-action="edit-thread" type="button">[ REVISE ]</button>` : ""
    ].join("");
    const actionGroup = actions ? `<div class="thread-actions">${actions}</div>` : "";
    const replyForm = hasPermission("reply") ? `<form class="reply-form" hidden><input name="author" value="${escapeHtml(member.name)}" required maxlength="48"><input name="body" required maxlength="600" placeholder="REPLY"><button type="submit">[ POST ]</button></form>` : "";
    return `<article class="thread-card" data-id="${escapeHtml(thread.id)}">
      <div class="thread-meta"><span class="category-tag tag-${escapeHtml(thread.category)}">${escapeHtml(thread.category)}</span><span>${escapeHtml(thread.author)}</span><span>/</span><time>${formatDate(thread.createdAt)}</time></div>
      <h3>${escapeHtml(thread.title)}</h3><p>${escapeHtml(thread.body)}</p>${replies ? `<div class="reply-list">${replies}</div>` : ""}
      <div class="thread-footer"><span class="job-owner">${(thread.replies || []).length} REPLIES</span>${actionGroup}</div>${replyForm}
    </article>`;
  }).join("");
  document.querySelector("#thread-empty").hidden = threads.length > 0;
  document.querySelector("#thread-count").textContent = String(board.threads.length).padStart(2, "0");
  document.querySelector("#memory-count").textContent = String(board.threads.length).padStart(2, "0");
}

function renderJobs() {
  const jobs = [...board.jobs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  document.querySelector("#job-list").innerHTML = jobs.map((job) => {
    const safeContact = escapeHtml(job.contact);
    const contact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.contact)
      ? `<a href="mailto:${safeContact}">${safeContact}</a>` : safeContact;
    const revise = hasPermission("revise_board") ? `<button class="quiet-button" data-action="edit-job" type="button">[ REVISE ]</button>` : "";
    return `<article class="job-card" data-id="${escapeHtml(job.id)}"><div class="job-topline"><span>[ OPEN ]</span><span class="job-location">${escapeHtml(job.location || "- NOT SET -")}</span></div><h3>${escapeHtml(job.title)}</h3><div class="job-owner">${escapeHtml(job.organization)} / ${formatDate(job.createdAt)}</div><p>${escapeHtml(job.body)}</p><div class="job-contact">CONTACT: ${contact}</div><div class="job-footer"><span class="job-owner">[ STAFF ]</span>${revise}</div></article>`;
  }).join("");
  document.querySelector("#job-empty").hidden = jobs.length > 0;
  document.querySelector("#opening-count").textContent = String(board.jobs.length).padStart(2, "0");
}

async function refreshBoard() {
  try {
    board = await api("/api/board");
    loadCopy(board.copy);
    renderThreads();
    renderJobs();
  } catch (error) {
    setStatus("#topic-status", `BOARD LOAD ERROR: ${error.message}`, true);
  }
}

async function refreshSession() {
  try {
    const result = await api("/api/session");
    setMember(result.member);
  } catch {
    setMember(null);
  }
}

document.querySelector("#member-sign-out").addEventListener("click", async () => {
  try { await api("/api/logout", "POST", {}); } catch (error) { setStatus("#topic-status", error.message, true); }
  setMember(null);
});

document.querySelector("#manage-permissions").addEventListener("click", async () => {
  if (!hasPermission("manage_permissions")) return;
  try {
    const result = await api("/api/permissions");
    document.querySelectorAll(".permissions-grid input[data-role]").forEach((checkbox) => {
      checkbox.checked = result.roles[checkbox.dataset.role]?.[checkbox.dataset.permission] === true;
    });
    const panel = document.querySelector("#permissions-panel");
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    setStatus("#topic-status", error.message, true);
  }
});

document.querySelector("#close-permissions").addEventListener("click", () => {
  document.querySelector("#permissions-panel").hidden = true;
});

document.querySelector("#permissions-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!hasPermission("manage_permissions")) return;
  const roles = { member: {}, staff: {} };
  document.querySelectorAll(".permissions-grid input[data-role]").forEach((checkbox) => {
    roles[checkbox.dataset.role][checkbox.dataset.permission] = checkbox.checked;
  });
  try {
    const result = await api("/api/permissions", "PUT", { roles });
    member.permissions = result.roles[member.role] || {};
    setMember(member);
    setStatus("#permissions-status", "RIGHTS SAVED.");
  } catch (error) {
    setStatus("#permissions-status", error.message, true);
  }
});

document.querySelector("#topic-filter").addEventListener("change", renderThreads);
document.querySelector("#new-topic-button").addEventListener("click", () => {
  if (!hasPermission("post_thread")) return;
  editingThreadId = null;
  const form = document.querySelector("#topic-form");
  form.reset();
  form.elements.author.value = member.name;
  document.querySelector("#topic-form-mode").textContent = "NEW THREAD";
  form.hidden = false;
  form.elements.title.focus();
});
document.querySelector("#new-job-button").addEventListener("click", () => {
  if (!hasPermission("post_job")) return;
  editingJobId = null;
  const form = document.querySelector("#job-form");
  form.reset();
  document.querySelector("#job-form-mode").textContent = "NEW LISTING";
  form.hidden = false;
  form.elements.title.focus();
});
document.querySelectorAll(".close-form").forEach((button) => button.addEventListener("click", () => {
  button.closest("form").hidden = true;
}));

document.querySelector("#topic-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!hasPermission(editingThreadId ? "revise_board" : "post_thread")) return;
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  try {
    if (editingThreadId) await api(`/api/threads/${encodeURIComponent(editingThreadId)}`, "PUT", values);
    else await api("/api/threads", "POST", values);
    form.hidden = true;
    editingThreadId = null;
    await refreshBoard();
    setStatus("#topic-status", "POST SAVED.");
  } catch (error) {
    setStatus("#topic-status", error.message, true);
  }
});

document.querySelector("#job-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!hasPermission(editingJobId ? "revise_board" : "post_job")) return;
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  try {
    if (editingJobId) await api(`/api/jobs/${encodeURIComponent(editingJobId)}`, "PUT", values);
    else await api("/api/jobs", "POST", values);
    form.hidden = true;
    editingJobId = null;
    await refreshBoard();
    setStatus("#job-status", "LISTING SAVED.");
  } catch (error) {
    setStatus("#job-status", error.message, true);
  }
});

document.querySelector("#thread-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const permission = button.dataset.action === "reply" ? "reply" : "revise_board";
  if (!hasPermission(permission)) return;
  const card = button.closest(".thread-card");
  const thread = board.threads.find((item) => item.id === card.dataset.id);
  if (button.dataset.action === "reply") {
    const form = card.querySelector(".reply-form");
    form.hidden = !form.hidden;
    if (!form.hidden) form.elements.body.focus();
  } else {
    editingThreadId = thread.id;
    const form = document.querySelector("#topic-form");
    for (const [name, value] of Object.entries(thread)) if (form.elements[name]) form.elements[name].value = value;
    document.querySelector("#topic-form-mode").textContent = "REVISE THREAD";
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

document.querySelector("#thread-list").addEventListener("submit", async (event) => {
  if (!event.target.matches(".reply-form") || !hasPermission("reply")) return;
  event.preventDefault();
  const threadId = event.target.closest(".thread-card").dataset.id;
  try {
    await api(`/api/threads/${encodeURIComponent(threadId)}/replies`, "POST", Object.fromEntries(new FormData(event.target)));
    await refreshBoard();
    setStatus("#topic-status", "REPLY SAVED.");
  } catch (error) {
    setStatus("#topic-status", error.message, true);
  }
});

document.querySelector("#job-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action=edit-job]");
  if (!button || !hasPermission("revise_board")) return;
  const job = board.jobs.find((item) => item.id === button.closest(".job-card").dataset.id);
  editingJobId = job.id;
  const form = document.querySelector("#job-form");
  for (const [name, value] of Object.entries(job)) if (form.elements[name]) form.elements[name].value = value;
  document.querySelector("#job-form-mode").textContent = "REVISE LISTING";
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
});

document.querySelectorAll(".copy-field[data-copy]").forEach((field) => {
  field.addEventListener("input", () => {
    document.querySelectorAll(`.copy-field[data-copy="${field.dataset.copy}"]`).forEach((other) => {
      if (other !== field) other.value = field.value;
    });
  });
});

document.querySelector("#save-copy").addEventListener("click", async () => {
  if (!hasPermission("edit_copy")) return;
  const copy = {};
  for (const key of copyKeys) copy[key] = document.querySelector(`.copy-field[data-copy="${key}"]`)?.value || "";
  try {
    await api("/api/copy", "PUT", { copy });
    board.copy = copy;
    setAuthStatus("[ SITE COPY SAVED ]");
  } catch (error) {
    setAuthStatus(error.message, true);
  }
});

document.querySelector("#request-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const url = new URL("https://mail.google.com/mail/");
  url.searchParams.set("view", "cm");
  url.searchParams.set("fs", "1");
  url.searchParams.set("to", "doinkytungo@gmail.com");
  url.searchParams.set("su", `YodieLand info request: ${values.topic}`);
  url.searchParams.set("body", `From: ${values.name}\nEmail: ${values.email}\n\n${values.message}`);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
  document.querySelector("#request-success").hidden = false;
  event.currentTarget.reset();
});

function updateClock() {
  document.querySelector("#local-clock").textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

setMember(null);
refreshBoard();
refreshSession();
updateClock();
setInterval(updateClock, 60_000);
