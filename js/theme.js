/* =====================================================================
   Evoke Organogram — theme background: teal particle network on #bg-canvas
   (mirrors the Income Fix site). Pure canvas, no deps. Respects
   prefers-reduced-motion. Safe to remove with the theme.
   ===================================================================== */
(function () {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var dpr = window.devicePixelRatio || 1;
  var w, h, pts, mouse = { x: -9999, y: -9999 };
  var COUNT = function () { return Math.min(80, Math.floor(window.innerWidth / 18)); };
  var LINK;

  function resize() {
    w = canvas.width = window.innerWidth * dpr;
    h = canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    LINK = 130 * dpr;
    init();
  }
  function init() {
    pts = [];
    var n = COUNT();
    for (var i = 0; i < n; i++) {
      pts.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25 * dpr,
        vy: (Math.random() - 0.5) * 0.25 * dpr,
        r: (Math.random() * 1.6 + 0.6) * dpr
      });
    }
  }
  window.addEventListener("mousemove", function (e) { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; });

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(94,234,212,0.5)";
      ctx.fill();
      for (var j = i + 1; j < pts.length; j++) {
        var q = pts[j];
        var dx = p.x - q.x, dy = p.y - q.y;
        var d = Math.hypot(dx, dy);
        if (d < LINK) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = "rgba(56,189,248," + (0.16 * (1 - d / LINK)) + ")";
          ctx.lineWidth = dpr;
          ctx.stroke();
        }
      }
      var mdx = p.x - mouse.x, mdy = p.y - mouse.y;
      var md = Math.hypot(mdx, mdy);
      if (md < LINK * 1.4) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y); ctx.lineTo(mouse.x, mouse.y);
        ctx.strokeStyle = "rgba(129,140,248," + (0.22 * (1 - md / (LINK * 1.4))) + ")";
        ctx.lineWidth = dpr;
        ctx.stroke();
      }
    }
    requestAnimationFrame(draw);
  }
  window.addEventListener("resize", resize);
  resize(); draw();
})();
