/* =====================================================================
   Supabase connection — fill these in to turn on the cloud (load/save/realtime).
   Find them in your Supabase project: Settings → API.
   The anon (public) key is SAFE to commit in a static site — your data is
   protected by Row Level Security + login (see supabase/setup.sql), not by
   hiding this key. Leave the placeholders to keep the app fully offline/static.
   ===================================================================== */
window.SUPABASE_CONFIG = {
  url:     "https://copyyjljpfijssdecycv.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvcHl5amxqcGZpanNzZGVjeWN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NTMyMTcsImV4cCI6MjA5ODEyOTIxN30.jc4LS9PiTRU5PmXzQCQUAlioEu4w6akaN--MwZZKvrg",
  table:   "organogram",              // table created by supabase/setup.sql
  rowId:   1                          // the single row that holds the whole org
};
