/* =====================================================================
   Evoke Organogram — theme background: a twinkling STARFIELD on #bg-canvas.
   (Replaces the old particle network.) Pure canvas, no deps. Respects
   prefers-reduced-motion. Safe to remove with the theme.
   ===================================================================== */
(function () {
  var canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var dpr = window.devicePixelRatio || 1;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var w, h, stars;

  function count() { return Math.min(300, Math.floor((window.innerWidth * window.innerHeight) / 6500)); }

  function make() {
    stars = [];
    var n = count();
    for (var i = 0; i < n; i++) {
      var big = Math.random() < 0.12;
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: (big ? Math.random() * 1.3 + 1.1 : Math.random() * 0.9 + 0.4) * dpr,
        base: Math.random() * 0.5 + 0.35,        // base brightness
        amp: Math.random() * 0.45 + 0.2,         // twinkle amplitude
        sp: Math.random() * 1.6 + 0.4,           // twinkle speed
        ph: Math.random() * Math.PI * 2,         // phase
        teal: Math.random() < 0.22,              // a few teal-tinted stars
        drift: (Math.random() * 0.12 + 0.02) * dpr
      });
    }
  }
  function resize() {
    w = canvas.width = window.innerWidth * dpr;
    h = canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    make();
  }

  function render(t) {
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = reduce ? s.base : s.base + s.amp * Math.sin(t * 0.001 * s.sp + s.ph);
      if (a < 0.04) a = 0.04; if (a > 1) a = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.teal ? "rgba(94,234,212," + a + ")" : "rgba(214,232,255," + a + ")";
      ctx.fill();
      // soft halo on the brighter stars
      if (s.r > 1.4 * dpr) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 2.4, 0, Math.PI * 2);
        ctx.fillStyle = (s.teal ? "rgba(94,234,212," : "rgba(180,214,255,") + (a * 0.12) + ")";
        ctx.fill();
      }
      if (!reduce) { s.y += s.drift; if (s.y > h) { s.y = 0; s.x = Math.random() * w; } }
    }
    requestAnimationFrame(render);
  }

  window.addEventListener("resize", resize);
  resize();
  if (reduce) render(0); else requestAnimationFrame(render);
})();
