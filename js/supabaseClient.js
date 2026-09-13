// Loaded straight from the CDN as an ES module — no bundler/npm install needed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

if (!SUPABASE_URL || SUPABASE_URL.includes("YOUR-PROJECT-REF")) {
  // eslint-disable-next-line no-console
  console.warn(
    "Supabase is not configured yet. Copy js/config.example.js to js/config.js and fill in " +
      "your project URL and anon key."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
