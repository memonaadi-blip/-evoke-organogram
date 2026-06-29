/* =====================================================================
   Supabase connection — fill these in to turn on the cloud (load/save/realtime).
   Find them in your Supabase project: Settings → API.
   The anon (public) key is SAFE to commit in a static site — your data is
   protected by Row Level Security + login (see supabase/setup.sql), not by
   hiding this key. Leave the placeholders to keep the app fully offline/static.
   ===================================================================== */
window.SUPABASE_CONFIG = {
  url:     "YOUR_SUPABASE_URL",       // e.g. https://abcd1234efgh.supabase.co
  anonKey: "YOUR_SUPABASE_ANON_KEY",  // Settings → API → Project API keys → anon public
  table:   "organogram",              // table created by supabase/setup.sql
  rowId:   1                          // the single row that holds the whole org
};
