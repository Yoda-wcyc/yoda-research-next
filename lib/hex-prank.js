// 首頁六角鈕惡作劇（2026-10-11 Yoda）：四顆繞行鈕（a.orbiter）讀者前兩次要按就極速逃開，第三次乖乖給按。
//   - 中心「會員專區」（.hexbtn）不參與，照常一按就進。
//   - 桌機：滑鼠／筆靠近（距離 < NEAR）算一次；觸控／點擊：pointerdown 算一次，並吃掉接著那一下 click。
//   - 位移只用 CSS 個別屬性 translate（與既有 transform 動畫疊加，不動版面流）；目標留在可視範圍、不壓其他鈕。
//   - 一有鈕逃開就凍結整組繞行（.prank-freeze），位置才算得準、停下後也不會再漂走；重新整理回原位。
//   - sessionStorage 記已停下的鈕（索引），四顆都停過就整個分頁階段不再整。
//   - 鍵盤 Tab＋Enter 不經 pointer，直接進；prefers-reduced-motion 時整個停用。
//   - 只改 style、不增刪 DOM 節點，與 lib/gt-guard.js（英文模式翻譯防護）互不干擾。
const KEY = "yr_hexprank";
const MAX = 2;      // 逃幾次後停下
const NEAR = 40;    // 滑鼠靠近幾 px 就逃
const DUR = 150;    // 逃跑時間（ms）
const PAD = 10;     // 離視窗邊緣
const GAP = 8;      // 離其他鈕／固定元件
const AWAY = 110;   // 新位置離游標至少

const rectOf = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
const rectDist = (a, b) => Math.hypot(Math.max(0, b.l - a.r, a.l - b.r), Math.max(0, b.t - a.b, a.t - b.b));
const ptDist = (x, y, a) => Math.hypot(Math.max(0, a.l - x, x - a.r), Math.max(0, a.t - y, y - a.b));

export function initHexPrank(root) {
  const noop = () => {};
  if (!root || typeof window === "undefined") return noop;
  try { if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return noop; } catch (e) {}
  const btns = Array.from(root.querySelectorAll("a.orbiter"));
  if (!btns.length) return noop;

  let settled = [];
  try { settled = JSON.parse(sessionStorage.getItem(KEY) || "[]"); if (!Array.isArray(settled)) settled = []; } catch (e) { settled = []; }
  const st = btns.map((el, i) => ({ el, n: settled.includes(i) ? MAX : 0, dx: 0, dy: 0, busy: 0 }));
  if (st.every(s => s.n >= MAX)) return noop;

  let blockClick = 0, raf = 0, lastX = 0, lastY = 0, vw0 = document.documentElement.clientWidth;
  const now = () => performance.now();
  const save = () => {
    try { sessionStorage.setItem(KEY, JSON.stringify(st.map((s, i) => (s.n >= MAX ? i : -1)).filter(i => i >= 0))); } catch (e) {}
  };
  const spin = (el, frames, ms) => { try { el.animate(frames, { duration: ms, easing: "ease-out" }); } catch (e) {} };

  function escape(s, px, py) {
    root.classList.add("prank-freeze");               // 先凍結繞行，量到的位置才是最終位置
    const el = s.el, r = rectOf(el);
    // 以「目標位置」為準：扣掉動畫中途的 translate、加回目標 translate（不受上一次逃跑動畫進度影響）
    const cur = (getComputedStyle(el).translate || "").split(" ").map(parseFloat);
    const cx = isFinite(cur[0]) ? cur[0] : 0, cy = isFinite(cur[1]) ? cur[1] : 0;
    const fx = s.dx - cx, fy = s.dy - cy;
    r.l += fx; r.r += fx; r.t += fy; r.b += fy;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const obs = [];
    root.querySelectorAll("a.orbiter, a.hexbtn").forEach(b => { if (b !== el) obs.push(rectOf(b)); });
    document.querySelectorAll(".ctrl, .tablet-hint").forEach(b => { const o = rectOf(b); if (o.w && o.h) obs.push(o); });
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 80; k++) {
      const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 150;
      const x = clamp(r.l + Math.cos(a) * d, PAD, vw - r.w - PAD);
      const y = clamp(r.t + Math.sin(a) * d, PAD, vh - r.h - PAD);
      const c = { l: x, t: y, r: x + r.w, b: y + r.h };
      const gap = obs.length ? Math.min(...obs.map(o => rectDist(c, o))) : 999;
      const far = ptDist(px, py, c), moved = Math.hypot(x - r.l, y - r.t);
      const score = Math.min(gap - GAP, (far - AWAY) / 4, (moved - 90) / 4);
      if (score > bestScore) { bestScore = score; best = c; }
      if (score >= 0) break;
    }
    s.dx += best.l - r.l; s.dy += best.t - r.t;
    s.n += 1; s.busy = now() + DUR + 120;
    el.style.transition = "translate " + DUR + "ms cubic-bezier(.2,.9,.25,1.15), filter .15s";
    el.style.translate = s.dx.toFixed(1) + "px " + s.dy.toFixed(1) + "px";
    const tilt = (best.l > r.l ? 1 : -1) * 16;
    spin(el, [{ rotate: "0deg" }, { rotate: tilt + "deg", offset: .45 }, { rotate: "0deg" }], DUR + 60);
    if (s.n >= MAX) {                                    // 認輸：落地小晃一下
      setTimeout(() => spin(el, [{ rotate: "0deg" }, { rotate: "-9deg" }, { rotate: "8deg" }, { rotate: "-5deg" }, { rotate: "3deg" }, { rotate: "0deg" }], 460), DUR + 20);
      save();
      if (st.every(q => q.n >= MAX)) detach();
    }
  }

  const live = s => s.n < MAX && now() > s.busy;
  function check() {
    raf = 0;
    for (const s of st) {
      if (!live(s)) continue;
      if (ptDist(lastX, lastY, rectOf(s.el)) < NEAR) { escape(s, lastX, lastY); break; }
    }
  }
  function onMove(e) {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    lastX = e.clientX; lastY = e.clientY;
    if (!raf) raf = requestAnimationFrame(check);
  }
  function onDown(e) {
    const a = e.target && e.target.closest ? e.target.closest("a.orbiter") : null;
    const s = a && st.find(q => q.el === a);
    if (!s || s.n >= MAX) return;                        // 已停下（或不是四顆之一）：照常
    blockClick = now() + 900;                            // 吃掉這一下接著的 click
    if (e.pointerType === "mouse") e.preventDefault();
    if (now() > s.busy) escape(s, e.clientX, e.clientY);
  }
  function onClick(e) {
    if (!blockClick) return;
    const hit = now() < blockClick; blockClick = 0;
    if (hit) { e.preventDefault(); e.stopPropagation(); }
  }
  function onResize() {                                  // 轉向／改寬：逃開的鈕回原位，避免跑出畫面
    const vw = document.documentElement.clientWidth;
    if (vw === vw0) return;
    vw0 = vw;
    st.forEach(s => { if (s.dx || s.dy) { s.dx = s.dy = 0; s.el.style.translate = ""; } });
  }

  document.addEventListener("pointermove", onMove, { passive: true });
  root.addEventListener("pointerdown", onDown, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("resize", onResize);
  let detached = false;
  function detach() {
    if (detached) return; detached = true;
    document.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerdown", onDown, true);
    if (raf) cancelAnimationFrame(raf);
    setTimeout(() => document.removeEventListener("click", onClick, true), 1000);
  }
  return () => { detach(); document.removeEventListener("click", onClick, true); window.removeEventListener("resize", onResize); };
}
