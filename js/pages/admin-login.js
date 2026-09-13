import { mountSidebar } from "../components/sidebar.js";
import { supabase } from "../supabaseClient.js";

mountSidebar("admin-login.html");

const el = {
  banner: document.getElementById("login-banner"),
  form: document.getElementById("login-form"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  submitBtn: document.getElementById("submit-btn")
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Already signed in? Skip straight to the admin panel.
supabase.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = "admin-rules.html";
});

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  el.banner.innerHTML = "";
  el.submitBtn.disabled = true;
  el.submitBtn.textContent = "Signing in…";

  const { error } = await supabase.auth.signInWithPassword({
    email: el.email.value,
    password: el.password.value
  });

  el.submitBtn.disabled = false;
  el.submitBtn.textContent = "Sign in";

  if (error) {
    el.banner.innerHTML = `<div class="banner banner--error">${escapeHtml(error.message)}</div>`;
    return;
  }

  window.location.href = "admin-rules.html";
});
