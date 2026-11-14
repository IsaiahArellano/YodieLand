let board = { threads: [], jobs: [], copy: {} };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "DATE UNKNOWN" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function renderThreads() {
  const filter = document.querySelector("#topic-filter").value;
  const threads = [...board.threads].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .filter((thread) => filter === "all" || thread.category === filter);
  document.querySelector("#thread-list").innerHTML = threads.map((thread) => {
    const role = thread.authorRole === "staff" ? "staff" : "member";
    const replies = (thread.replies || []).map((reply) => {
      const replyRole = reply.authorRole === "staff" ? "staff" : "member";
      return `<div class="reply-item"><b>${escapeHtml(reply.author)} <span class="role-badge role-${replyRole}">[ ${replyRole.toUpperCase()} ]</span>:</b> ${escapeHtml(reply.body)}</div>`;
    }).join("");
    return `<article class="thread-card"><div class="thread-meta"><span class="category-tag">${escapeHtml(thread.category || "community")}</span><span>${escapeHtml(thread.author)}</span><span class="role-badge role-${role}">[ ${role.toUpperCase()} ]</span><span>/</span><time>${formatDate(thread.createdAt)}</time></div><h3>${escapeHtml(thread.title)}</h3><p>${escapeHtml(thread.body)}</p>${replies ? `<div class="reply-list">${replies}</div>` : ""}</article>`;
  }).join("");
  document.querySelector("#thread-empty").hidden = threads.length > 0;
  document.querySelector("#thread-count").textContent = String(board.threads.length).padStart(2, "0");
  document.querySelector("#memory-count").textContent = String(board.threads.length).padStart(2, "0");
}

function renderJobs() {
  document.querySelector("#job-list").innerHTML = board.jobs.map((job) => {
    const role = job.authorRole === "staff" ? "staff" : "member";
    const contact = escapeHtml(job.contact || "");
    const contactLink = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? `<a href="mailto:${contact}">${contact}</a>` : contact;
    return `<article class="job-card"><div class="job-topline"><span>[ OPEN ]</span><span class="job-location">${escapeHtml(job.location || "- NOT SET -")}</span></div><h3>${escapeHtml(job.title)}</h3><div class="job-owner">${escapeHtml(job.organization)} / ${formatDate(job.createdAt)} <span class="role-badge role-${role}">[ ${role.toUpperCase()} ]</span></div><p>${escapeHtml(job.body)}</p>${contact ? `<div class="job-contact">CONTACT: ${contactLink}</div>` : ""}</article>`;
  }).join("");
  document.querySelector("#job-empty").hidden = board.jobs.length > 0;
  document.querySelector("#opening-count").textContent = String(board.jobs.length).padStart(2, "0");
}

function loadCopy(copy) {
  document.querySelector("#page-title").textContent = copy.heroTitle || "Mason's Club";
  document.querySelector("#intro-copy").textContent = copy.intro || "";
  document.querySelector("#board-note").textContent = copy.note || "";
  document.querySelector("#jobs-copy").textContent = copy.jobs || "";
  document.querySelector("#status-copy").textContent = copy.status || "";
  document.querySelector("#archive-copy").textContent = copy.archive || "";
  document.querySelector("#request-copy").textContent = copy.request || "";
  document.querySelector("#footer-copy").textContent = copy.footer || "";
}

async function loadBoard() {
  try {
    const response = await fetch("./YodieLand-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`DATA REQUEST ${response.status}`);
    board = await response.json();
    board.threads = Array.isArray(board.threads) ? board.threads : [];
    board.jobs = Array.isArray(board.jobs) ? board.jobs : [];
    loadCopy(board.copy || {});
    renderThreads();
    renderJobs();
  } catch (error) {
    document.querySelector("#thread-empty").hidden = false;
    document.querySelector("#thread-empty").textContent = `[ DATA ERROR: ${error.message} ]`;
    document.querySelector("#job-empty").hidden = false;
    document.querySelector("#job-empty").textContent = "[ JOB DATA UNAVAILABLE ]";
  }
}

document.querySelector("#topic-filter").addEventListener("change", renderThreads);
document.querySelector("#request-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const url = new URL("mailto:doinkytungo@gmail.com");
  url.searchParams.set("subject", `YodieLand info request: ${values.topic}`);
  url.searchParams.set("body", `From: ${values.name}\nEmail: ${values.email}\n\n${values.message}`);
  window.location.href = url.toString();
});
document.querySelector(".nav-dropdown").addEventListener("click", (event) => {
  if (event.target.closest("a[href^='#']")) event.currentTarget.open = false;
});

loadBoard();
