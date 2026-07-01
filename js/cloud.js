/* =====================================================================
   Evoke Organogram — Supabase cloud layer (optional, opt-in).
   Wires the static app to a single Supabase row:
     4.3  load the org from the cloud on page open
     4.4  realtime: viewers update instantly when it changes
     4.5  ?edit=1 editing is gated behind a login
     4.6  signed-in admins publish edits back to the cloud
   Stays completely inert until js/supabase-config.js is filled in.
   ===================================================================== */
(function () {
  "use strict";
  var SC = window.SUPABASE_CONFIG || {};
  var configured = /^https?:\/\//.test(SC.url || "") && (SC.anonKey || "").length > 20;
  if (!configured) return;                                   // offline/static mode
  if (!window.supabase || !window.supabase.createClient) {   // CDN didn't load
    console.warn("[cloud] Supabase JS not loaded — staying offline.");
    return;
  }
  var ORG = window.ORG || {};
  var TABLE = SC.table || "organogram";
  var ROW = SC.rowId == null ? 1 : SC.rowId;
  var db = window.supabase.createClient(SC.url, SC.anonKey);
  var session = null;

  function toast(m, sub) { if (ORG.toast) ORG.toast(m, sub); }

  /* ---- 4.3  load the org on page open ---- */
  async function load() {
    var res = await db.from(TABLE).select("employees,config").eq("id", ROW).maybeSingle();
    if (res.error) { console.warn("[cloud] load:", res.error.message); return; }
    if (res.data && Array.isArray(res.data.employees)) {
      ORG.applyData && ORG.applyData(res.data.employees, res.data.config || null);
    } else {
      console.info("[cloud] no row " + ROW + " yet — sign in and Publish to seed it.");
    }
  }

  /* ---- 4.4  realtime: apply remote changes for viewers ---- */
  function subscribe() {
    db.channel("org-row-" + ROW)
      .on("postgres_changes",
        { event: "*", schema: "public", table: TABLE, filter: "id=eq." + ROW },
        function (payload) {
          var row = payload.new;
          if (!row || !Array.isArray(row.employees)) return;
          if (ORG.isDirty && ORG.isDirty()) {
            toast("Cloud updated", "your local edits are kept — Publish to overwrite or Discard to load the latest");
          } else {
            ORG.applyData && ORG.applyData(row.employees, row.config || null);
            toast("Updated from cloud");
          }
        })
      .subscribe();
  }

  /* ---- 4.6  publish the working set back to the cloud ---- */
  async function publish(silent) {
    if (!session) { if(!silent) openLogin(); return; }
    if (!silent) toast("Publishing…");
    var payload = {
      id: ROW,
      employees: ORG.currentData(),
      config: ORG.currentConfig(),
      updated_at: new Date().toISOString()
    };
    var res = await db.from(TABLE).upsert(payload, { onConflict: "id" });
    if (res.error) { if(silent) console.warn("[cloud] auto-sync failed:", res.error.message); else toast("Publish failed", res.error.message); return; }
    ORG.markSaved && ORG.markSaved();
    toast(silent ? "Synced to cloud" : "Published to the cloud", silent ? "" : "everyone sees it now");
  }
  // auto-publish: every authorised edit syncs to the cloud (debounced) so other
  // browsers get it live via the realtime subscription
  var autoT;
  function autoPublish(){ clearTimeout(autoT); autoT=setTimeout(function(){ publish(true); }, 1500); }

  /* ---- 4.5  auth gate ---- */
  function openLogin() { var o = document.getElementById("login-overlay"); if (o) o.classList.add("show"); }
  function closeLogin() { var o = document.getElementById("login-overlay"); if (o) o.classList.remove("show"); }

  function reflectAuth() {
    var signedIn = !!session;
    document.body.classList.toggle("signed-in", signedIn);
    var authBtn = document.getElementById("cloud-auth");
    if (authBtn) {
      authBtn.style.display = "";
      authBtn.textContent = signedIn ? "Sign out" : "Sign in to edit";
      authBtn.title = signedIn ? ("Signed in as " + (session.user && session.user.email || "admin")) : "Sign in to edit and publish";
    }
    // unlock / relock editing
    if (ORG.setEditAllowed) ORG.setEditAllowed(signedIn && ORG.wantsEdit);
    // authorised edits auto-sync to the cloud so viewers update live
    ORG.onEdit = signedIn ? autoPublish : null;
    // the "unsaved edits" banner button also publishes on demand when signed in
    var be = document.getElementById("banner-export");
    if (be) {
      be.textContent = signedIn ? "Publish to cloud" : "Export employees.js";
      be.onclick = signedIn ? function(){ publish(false); } : be.onclick;   // keep the file-export fallback when signed out
    }
  }

  async function initAuth() {
    var got = await db.auth.getSession();
    session = got.data.session;
    reflectAuth();
    db.auth.onAuthStateChange(function (_evt, s) { session = s; reflectAuth(); });

    var authBtn = document.getElementById("cloud-auth");
    if (authBtn) authBtn.onclick = function () { if (session) db.auth.signOut(); else openLogin(); };

    var form = document.getElementById("login-form");
    if (form) form.onsubmit = async function (ev) {
      ev.preventDefault();
      var email = (document.getElementById("login-email").value || "").trim();
      var pass = document.getElementById("login-pass").value || "";
      var msg = document.getElementById("login-msg");
      msg.textContent = "Signing in…";
      var res = await db.auth.signInWithPassword({ email: email, password: pass });
      if (res.error) { msg.textContent = res.error.message; return; }
      msg.textContent = ""; closeLogin();
      toast("Signed in", "editing unlocked");
    };
  }

  load();
  subscribe();
  initAuth();
})();
