import { supabase } from "../supabaseClient.js";

const LINKS = [
  { href: "index.html", label: "Overview" },
  { href: "job-title-categorizer.html", label: "Job Title Categorizer" },
  { href: "phone-formatter.html", label: "Phone Number Formatter" },
  { href: "report-sync.html", label: "Report → Contact Sync" },
  { href: "highlight-latest.html", label: "Highlight Latest Rows" }
];

/**
 * Renders the sidebar into #sidebar-root and keeps the "Admin" section in sync
 * with the current Supabase auth session.
 * @param {string} activeHref - the current page's filename, e.g. "index.html"
 */
export function mountSidebar(activeHref) {
  const root = document.getElementById("sidebar-root");
  if (!root) return;

  function render(session) {
    const navLinks = LINKS.map(
      (l) =>
        `<a class="sidebar-link${l.href === activeHref ? " is-active" : ""}" href="${l.href}">${l.label}</a>`
    ).join("");

    const adminBlock = session
      ? `
        <a class="sidebar-link${activeHref === "admin-rules.html" ? " is-active" : ""}" href="admin-rules.html">Manage Rules</a>
        <a class="sidebar-link${activeHref === "admin-mappings.html" ? " is-active" : ""}" href="admin-mappings.html">Manage Field Mapping</a>
        <button class="sidebar-signout" id="sidebar-signout">Sign out (${session.user.email})</button>
      `
      : `<a class="sidebar-link${activeHref === "admin-login.html" ? " is-active" : ""}" href="admin-login.html">Sign in</a>`;

    root.innerHTML = `
      <aside class="sidebar">
        <div class="sidebar-brand">
          <span class="sidebar-brand-mark">RO</span>
          <div>
            <div class="sidebar-brand-name">Roster Ops</div>
            <div class="sidebar-brand-sub">Title &amp; Phone Toolkit</div>
          </div>
        </div>
        <nav class="sidebar-nav">${navLinks}</nav>
        <div class="sidebar-admin">
          <div class="sidebar-admin-label">Admin</div>
          ${adminBlock}
        </div>
      </aside>
    `;

    const signoutBtn = document.getElementById("sidebar-signout");
    if (signoutBtn) {
      signoutBtn.addEventListener("click", async () => {
        await supabase.auth.signOut();
        window.location.href = "index.html";
      });
    }
  }

  supabase.auth.getSession().then(({ data }) => render(data.session));
  supabase.auth.onAuthStateChange((_event, session) => render(session));
}
