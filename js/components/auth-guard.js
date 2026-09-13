import { supabase } from "../supabaseClient.js";

/**
 * Resolves once we know whether there's a session; redirects to the login page
 * and never resolves if there isn't one (the redirect navigates away).
 * @returns {Promise<object>} the Supabase session
 */
export function requireSession() {
  return supabase.auth.getSession().then(({ data }) => {
    if (!data.session) {
      window.location.href = "admin-login.html";
      return new Promise(() => {}); // hang forever; the redirect is already underway
    }
    return data.session;
  });
}
