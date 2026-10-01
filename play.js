/* CAO 2027 mini-games: "Keep it running" and "Spot the shift".
   Plain JavaScript, no dependencies. */
(function () {
  "use strict";

  const C = {
    ink: "#172536", ink2: "#4A5A6B", rule: "#D5DCE3", panel: "#FFFFFF",
    catch: "#B9820C", catchBright: "#E2A417", adapt: "#1C7684", operate: "#3D4BA3", fail: "#A9412D"
  };

  // ---------- helpers ----------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function fmt(x, d) { return x.toFixed(d === undefined ? 1 : d); }

  function setupCanvas(canvas, aspect) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const a = typeof aspect === "function" ? aspect(w) : aspect;
    const h = Math.round(w * a);
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  // =====================================================================
  // GAME 1: KEEP IT RUNNING
  // =====================================================================
  (function keepItRunning() {
    const root = document.getElementById("kir");
    if (!root) return;
    const canvas = root.querySelector("canvas");
    const btnStart = root.querySelector("[data-start]");
    const btnCatch = root.querySelector("[data-catch]");
    const btnAdapt = root.querySelector("[data-adapt]");
    const btnOperate = root.querySelector("[data-operate]");
    const hudTime = root.querySelector("[data-time]");
    const hudScore = root.querySelector("[data-score]");
    const hudState = root.querySelector("[data-state]");
    const live = root.querySelector("[data-live]");
    const intro = root.querySelector(".kir-intro");
    const result = root.querySelector(".kir-result");

    const DURATION = 30;          // seconds
    const DT = 1 / 30;            // simulation step
    const WINDOW = 15;            // seconds visible on the chart
    const ADAPT_DELAY = 0.6;      // retraining time
    const FORGET = 0.9;           // fraction of old knowledge that survives each update
    const ACC_GOOD = 0.88;        // above this, nothing is really wrong (an alarm is false)
    const LINE = 0.8;             // the alert line

    let S = null, raf = null, last = 0, acc = 0;
    const ASPECT = w => (w < 600 ? 0.62 : 0.42);
    let dims = setupCanvas(canvas, ASPECT);
    window.addEventListener("resize", () => { dims = setupCanvas(canvas, ASPECT); draw(S && S.done); });

    // Hidden world: gradual drift, a new normal, a sudden shift, then the original conditions return.
    function makeWorld() {
      const A = 0.2, B = rand(0.5, 0.6), Cc = rand(0.82, 0.9);
      const t1 = rand(3, 4.5), t2 = t1 + rand(3.5, 4.5), t3 = t2 + rand(3, 4), t4 = t3 + rand(5, 6);
      const segs = [
        { from: 0, to: t1, kind: "stable", a: A, b: A },
        { from: t1, to: t2, kind: "gradual", a: A, b: B },
        { from: t2, to: t3, kind: "stable", a: B, b: B },
        { from: t3, to: t4, kind: "sudden", a: Cc, b: Cc },
        { from: t4, to: DURATION + 1, kind: "return", a: A, b: A }
      ];
      const glitches = [{ from: rand(1, 2.2), len: 1.4 }, { from: t2 + rand(0.6, 1.4), len: 1.3 }];
      return { segs, glitches, A };
    }
    function envAt(world, t) {
      for (const s of world.segs) if (t >= s.from && t < s.to)
        return s.a + (s.b - s.a) * clamp((t - s.from) / (s.to - s.from), 0, 1);
      return world.A;
    }
    function glitchAt(world, t) { return world.glitches.some(g => t >= g.from && t < g.from + g.len); }
    function trueAcc(know, e) {
      let best = 0;
      for (const k of know) best = Math.max(best, k.w * Math.exp(-Math.pow((e - k.r) / 0.13, 2)));
      return 0.55 + 0.4 * best;
    }

    function reset() {
      S = { world: makeWorld(), t: 0, know: [{ r: 0.2, w: 1 }], obs: [], ema: 0.95,
            alarm: false, safe: false, pending: null, events: [],
            falseAlarms: 0, adapts: 0, missed: 0, safeTime: 0, up: 0, returnAcc: [], done: false };
    }
    function log(kind, text) { S.events.push({ t: S.t, kind }); if (text) say(text); }
    function say(t) { live.textContent = t; }

    function step() {
      const w = S.world, e = envAt(w, S.t);
      if (S.pending && S.t >= S.pending.at) {
        for (const k of S.know) k.w *= FORGET;
        S.know = S.know.filter(k => k.w > 0.04);
        S.know.push({ r: S.pending.e, w: 1 });
        S.pending = null;
        say("Update deployed.");
      }
      const a = trueAcc(S.know, e);
      const noise = glitchAt(w, S.t) ? 0.06 : 0.03;
      S.ema += (clamp(a + gauss() * noise, 0.3, 1) - S.ema) * 0.12;
      S.obs.push({ t: S.t, o: S.ema, a });
      // Score: time the model is reliable (above the line). Operate/safe mode counts half: no errors, but no service.
      if (S.safe) { S.up += 0.5 * DT; S.safeTime += DT; }
      else if (a >= LINE) S.up += DT;
      if (a < LINE && !S.alarm && !S.safe && !S.pending) S.missed += DT;
      if (S.t >= w.segs[w.segs.length - 1].from + 1) S.returnAcc.push(a);
      S.t += DT;
    }

    function score() {
      if (!S || S.t <= 0) return 0;
      return Math.round(clamp(100 * S.up / Math.max(S.t, DT) - 2 * S.falseAlarms, 0, 100));
    }

    function hud() {
      hudTime.textContent = Math.max(0, Math.ceil(DURATION - S.t)) + " s";
      hudScore.textContent = S.t > 0 ? score() + " / 100" : "– / 100";
      const low = S.obs.length && S.obs[S.obs.length - 1].o < LINE;
      let st = "All good: keep watching", warn = false;
      if (S.done) st = "Shift over";
      else if (S.pending) st = "Retraining…";
      else if (S.alarm) { st = "Alarm raised: now press Adapt"; warn = true; }
      else if (S.safe) st = "Operating in safe mode: users are waiting";
      else if (low) { st = "Below the line: press Catch"; warn = true; }
      hudState.textContent = st;
      hudState.classList.toggle("warn", warn);
      btnCatch.disabled = S.done || S.alarm || !!S.pending;
      btnAdapt.disabled = S.done || !S.alarm || !!S.pending;
      btnOperate.disabled = S.done;
      btnOperate.setAttribute("aria-pressed", S.safe ? "true" : "false");
      btnOperate.querySelector("span").textContent = S.safe ? "Resume" : "Operate safely";
      btnCatch.classList.toggle("nudge", !btnCatch.disabled && !!low && !S.safe);
      btnAdapt.classList.toggle("nudge", !btnAdapt.disabled);
    }

    function draw(reveal) {
      const { ctx, w, h } = dims;
      ctx.clearRect(0, 0, w, h);
      const padL = 38, padR = 10, padT = 12, padB = 24;
      const W = w - padL - padR, H = h - padT - padB;
      const t1 = S ? (reveal ? DURATION : Math.max(WINDOW, S.t)) : WINDOW;
      const t0 = reveal ? 0 : t1 - WINDOW;
      const X = t => padL + (t - t0) / (t1 - t0) * W;
      const Y = v => padT + (1 - (v - 0.4) / 0.6) * H;
      if (S && reveal) {
        const cols = { stable: "#EEF1F4", gradual: "#FBF0D9", sudden: "#F7E1DC", return: "#E3EEF0" };
        for (const s of S.world.segs) {
          const a = X(Math.max(s.from, t0)), b = X(Math.min(s.to, t1));
          if (b > a) { ctx.fillStyle = cols[s.kind]; ctx.fillRect(a, padT, b - a, H); }
        }
      }
      ctx.strokeStyle = "#E4E9EE"; ctx.lineWidth = 1; ctx.fillStyle = C.ink2; ctx.font = "12px Schibsted Grotesk, system-ui, sans-serif";
      for (const v of [0.5, 0.7, 0.9]) {
        ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(w - padR, Y(v)); ctx.stroke();
        ctx.fillText(Math.round(v * 100) + "%", 4, Y(v) + 4);
      }
      ctx.setLineDash([6, 6]); ctx.strokeStyle = C.catch; ctx.globalAlpha = .8;
      ctx.beginPath(); ctx.moveTo(padL, Y(LINE)); ctx.lineTo(w - padR, Y(LINE)); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = C.catch; ctx.fillText("alert line", w - padR - 56, Y(LINE) - 6);
      if (!S) return;
      ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
      let prev = null;
      for (const p of S.obs) {
        if (p.t < t0) continue;
        const x = X(p.t), y = Y(clamp(p.o, 0.4, 1));
        if (prev) { ctx.strokeStyle = p.o < LINE ? C.fail : C.ink; ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(x, y); ctx.stroke(); }
        prev = [x, y];
      }
      if (reveal) {
        ctx.strokeStyle = C.adapt; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath();
        S.obs.forEach((p, i) => { const x = X(p.t), y = Y(clamp(p.a, 0.4, 1)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke(); ctx.setLineDash([]);
      }
      const mk = { catch: C.catch, adapt: C.adapt, safe: C.operate, unsafe: C.operate, false: C.fail };
      const lab = { catch: "C", adapt: "A", safe: "O", unsafe: "O", false: "✕" };
      for (const ev of S.events) {
        if (ev.t < t0) continue;
        const x = X(ev.t);
        ctx.strokeStyle = mk[ev.kind]; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + H); ctx.stroke();
        ctx.fillStyle = mk[ev.kind]; ctx.beginPath(); ctx.arc(x, padT + 9, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 10px Schibsted Grotesk, system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(lab[ev.kind], x, padT + 12.5); ctx.textAlign = "left";
      }
      ctx.fillStyle = C.ink2; ctx.font = "12px Schibsted Grotesk, system-ui, sans-serif";
      ctx.fillText(reveal ? "what really happened (shaded) and true accuracy (dashed)" : "model accuracy: keep it above the line", padL, h - 6);
    }

    function loop(now) {
      if (!S || S.done) return;
      acc += Math.min(0.1, (now - last) / 1000); last = now;
      while (acc >= DT && S.t < DURATION) { step(); acc -= DT; }
      hud(); draw();
      if (S.t >= DURATION) return finish();
      raf = requestAnimationFrame(loop);
    }

    function start() {
      reset(); intro.hidden = true; result.hidden = true;
      last = performance.now(); acc = 0; hud(); draw();
      say("Shift started. When the line drops below the alert line, press Catch, then Adapt.");
      root.querySelector(".game").focus({ preventScroll: true });
      raf = requestAnimationFrame(loop);
    }

    function doCatch() {
      if (!S || S.done || S.alarm || S.pending) return;
      const a = trueAcc(S.know, envAt(S.world, S.t));
      if (a >= ACC_GOOD) { S.falseAlarms++; log("false", "False alarm: that was just noise. −2 points."); }
      else { S.alarm = true; log("catch", "Drift caught. Now press Adapt."); }
      hud();
    }
    function doAdapt() {
      if (!S || S.done || !S.alarm || S.pending) return;
      S.alarm = false; S.adapts++;
      S.pending = { at: S.t + ADAPT_DELAY, e: envAt(S.world, S.t) };
      log("adapt", "Retraining on recent data…");
      hud();
    }
    function doOperate() {
      if (!S || S.done) return;
      S.safe = !S.safe;
      log(S.safe ? "safe" : "unsafe", S.safe ? "Operating in safe mode: no errors, but users wait." : "Back to normal operation.");
      hud();
    }

    function finish() {
      S.done = true; cancelAnimationFrame(raf);
      hud(); draw(true);
      const sc = score();
      const lessons = [];
      const retAcc = S.returnAcc.length ? S.returnAcc.reduce((x, y) => x + y, 0) / S.returnAcc.length : 1;
      if (retAcc < 0.75 && S.adapts > 0) lessons.push(`When the original conditions came back, the model had partly forgotten them. Each update overwrote a little old knowledge: that is catastrophic forgetting.`);
      if (S.falseAlarms >= 1) lessons.push(`${S.falseAlarms} false alarm${S.falseAlarms > 1 ? "s" : ""}: some wiggles were just noise. Telling noise from real drift is the hard part of Catch.`);
      if (S.missed >= 4) lessons.push(`The model was below the line for ${fmt(S.missed)} s without an alarm. Gradual drift is easy to miss.`);
      if (S.safeTime >= 8) lessons.push(`You operated in safe mode for ${fmt(S.safeTime, 0)} s. No mistakes, but users waited: playing safe is not free.`);
      if (S.adapts === 0) lessons.push("You never adapted. Here the world really did change.");
      if (!lessons.length) lessons.push("A clean run: you caught real drift, adapted quickly, and kept the model reliable. That loop is what CAO is about.");
      const grade = sc >= 85 ? "Reliable operator! You win." : sc >= 75 ? "Nicely done. You win." : sc >= 65 ? "Getting there" : "Rough shift";
      result.querySelector("[data-final]").textContent = sc;
      result.querySelector("[data-grade]").textContent = grade;
      result.querySelector("[data-stats]").innerHTML =
        `<li><b>${S.adapts}</b> adaptations</li><li><b>${S.falseAlarms}</b> false alarms</li><li><b>${fmt(S.missed)} s</b> unnoticed drift</li><li><b>${fmt(S.safeTime, 0)} s</b> in safe mode</li>`;
      result.querySelector("[data-lessons]").innerHTML = lessons.map(l => `<li>${l}</li>`).join("");
      const share = result.querySelector("[data-share]");
      share.onclick = () => {
        const txt = `I scored ${sc}/100 keeping a deployed model reliable in "Keep it running" at CAO 2027. ${location.href.split("#")[0]}#kir`;
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
          () => { share.querySelector("span").textContent = "Copied"; },
          () => { share.querySelector("span").textContent = "Copy failed"; });
      };
      share.querySelector("span").textContent = "Copy my score";
      result.hidden = false;
      say(`Run over. Score ${sc} out of 100. ${grade}`);
    }

    btnStart.addEventListener("click", start);
    root.querySelector("[data-again]").addEventListener("click", start);
    btnCatch.addEventListener("click", doCatch);
    btnAdapt.addEventListener("click", doAdapt);
    btnOperate.addEventListener("click", doOperate);
    document.addEventListener("keydown", ev => {
      if (!S || S.done || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName || "")) return;
      const k = ev.key.toLowerCase();
      if (k === " " || k === "spacebar") { ev.preventDefault(); if (!ev.repeat) (S.alarm ? doAdapt : doCatch)(); }
      else if (k === "c" || k === "1") { ev.preventDefault(); doCatch(); }
      else if (k === "a" || k === "2") { ev.preventDefault(); doAdapt(); }
      else if (k === "o" || k === "3") { ev.preventDefault(); doOperate(); }
    });
    [btnCatch, btnAdapt, btnOperate].forEach(b => b.disabled = true);
    draw();
  })();

  // =====================================================================
  // GAME 2: SPOT THE SHIFT
  // =====================================================================
  (function spotTheShift() {
    const root = document.getElementById("sts");
    if (!root) return;
    const canvas = root.querySelector("canvas");
    const btnStart = root.querySelector("[data-start]");
    const btnShift = root.querySelector("[data-shift]");
    const hudRound = root.querySelector("[data-round]");
    const live = root.querySelector("[data-live]");
    const intro = root.querySelector(".sts-intro");
    const roundBox = root.querySelector(".sts-roundresult");
    const result = root.querySelector(".sts-result");

    const RATE = 12;          // points per second
    const FADE = 3.0;         // seconds a point stays visible
    const MISS_AFTER = 6;     // seconds after the change before it counts as missed
    const ROUNDS = [
      { name: "Shift right", hint: "the cloud moved right", gen: () => [gauss() + 2.2, gauss()] },
      { name: "Spread out", hint: "the cloud got wider", gen: () => [gauss() * 2.6, gauss() * 2.6] },
      { name: "New group", hint: "a new cluster appeared", gen: () => Math.random() < 0.4 ? [2.5 + gauss() * 0.35, 2.0 + gauss() * 0.35] : [gauss(), gauss()] },
      { name: "Shift down", hint: "the cloud moved down", gen: () => [gauss(), gauss() - 1.8] },
      { name: "Small shift", hint: "the cloud moved a little to the right", gen: () => [gauss() + 1.3, gauss()] }
    ];

    const ASPECT = w => (w < 600 ? 0.85 : 0.45);
    let dims = setupCanvas(canvas, ASPECT);
    window.addEventListener("resize", () => { dims = setupCanvas(canvas, ASPECT); draw(); });

    let G = null, R = null, raf = null, t0 = 0;

    // CUSUM detector on x-mean (both sides), y-mean (both sides), and radius² (up).
    // ---- SVD / PCA drift detector -------------------------------------------------
    // 1) Learn "normal" from the first REF seconds: mean and covariance, then an SVD of the
    //    covariance gives the principal axes U and variances L.
    // 2) Every new point is projected onto those axes and whitened. Over a sliding window of
    //    the last WIN points we test (a) whether the window mean moved (Hotelling T²) and
    //    (b) whether the spread along the axes changed (log-likelihood ratio of variances).
    // 3) Alarm when either statistic crosses its threshold (tuned for about 1-2% false alarms).
    const REF = 2.5, WIN = 24, T2_MAX = 30, SPREAD_MAX = 32;
    function svd2x2(a, b, d) {       // symmetric 2x2 [[a,b],[b,d]] -> rotation U and singular values L
      const th = 0.5 * Math.atan2(2 * b, a - d), c = Math.cos(th), s = Math.sin(th);
      return { U: [[c, s], [-s, c]], L: [a * c * c + 2 * b * c * s + d * s * s, a * s * s - 2 * b * c * s + d * c * c] };
    }
    function meanCov(pts) {
      const n = pts.length; let mx = 0, my = 0;
      for (const p of pts) { mx += p[0]; my += p[1]; } mx /= n; my /= n;
      let a = 0, b = 0, d = 0;
      for (const p of pts) { const x = p[0] - mx, y = p[1] - my; a += x * x; b += x * y; d += y * y; }
      return { mx, my, a: a / (n - 1), b: b / (n - 1), d: d / (n - 1) };
    }
    function makeDetector() {
      const D = { ref: [], model: null, win: [], winRaw: [], fired: null, firedWin: null, T2: 0, S: 0 };
      D.push = function (p) {
        if (D.fired !== null) return;
        if (p.t < REF) { D.ref.push(p.v); return; }
        if (!D.model) {
          const m = meanCov(D.ref), sv = svd2x2(m.a, m.b, m.d);
          D.model = { mx: m.mx, my: m.my, U: sv.U, L: [Math.max(sv.L[0], 1e-3), Math.max(sv.L[1], 1e-3)] };
        }
        const M = D.model, x = p.v[0] - M.mx, y = p.v[1] - M.my;
        D.win.push([(M.U[0][0] * x + M.U[0][1] * y) / Math.sqrt(M.L[0]), (M.U[1][0] * x + M.U[1][1] * y) / Math.sqrt(M.L[1])]);
        D.winRaw.push(p.v);
        if (D.win.length > WIN) { D.win.shift(); D.winRaw.shift(); }
        if (D.win.length < WIN) return;
        let m0 = 0, m1 = 0, v0 = 0, v1 = 0;
        for (const q of D.win) { m0 += q[0]; m1 += q[1]; v0 += q[0] * q[0]; v1 += q[1] * q[1]; }
        m0 /= WIN; m1 /= WIN; v0 /= WIN; v1 /= WIN;
        D.T2 = WIN * (m0 * m0 + m1 * m1);
        D.S = WIN / 2 * ((v0 - 1 - Math.log(v0)) + (v1 - 1 - Math.log(v1)));
        if (D.T2 > T2_MAX || D.S > SPREAD_MAX) { D.fired = p.t; D.firedWin = D.winRaw.slice(); D.why = D.T2 > T2_MAX ? "the average moved" : "the spread changed"; }
      };
      return D;
    }

    function makeRound(i) {
      const change = rand(3, 12), end = change + MISS_AFTER, cfg = ROUNDS[i];
      const stream = [];
      let t = 0;
      while (t < end) {
        t += -Math.log(Math.random()) / RATE;
        stream.push({ t, v: t < change ? [gauss(), gauss()] : cfg.gen() });
      }
      return { i, cfg, change, end, stream, D: makeDetector(), det: null, tap: null, shown: 0 };
    }

    function draw() {
      const { ctx, w, h } = dims;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, sc = Math.min(w, h) / 9;
      ctx.strokeStyle = "#E4E9EE"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
      const ellipse = (m, U, L, color, dash, axes) => {
        const ang = Math.atan2(U[0][1], U[0][0]);
        ctx.save(); ctx.translate(cx + m[0] * sc, cy - m[1] * sc); ctx.rotate(-ang);
        ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = 1.6;
        const r0 = 2 * Math.sqrt(L[0]) * sc, r1 = 2 * Math.sqrt(L[1]) * sc;
        ctx.beginPath(); ctx.ellipse(0, 0, r0, r1, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        if (axes) { ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(-r0, 0); ctx.lineTo(r0, 0); ctx.moveTo(0, -r1); ctx.lineTo(0, r1); ctx.stroke(); ctx.globalAlpha = 1; }
        ctx.restore();
      };
      ctx.font = "13px Schibsted Grotesk, system-ui, sans-serif"; ctx.fillStyle = C.ink2;
      if (!R || !R.D.model) {
        ctx.setLineDash([5, 5]); ctx.strokeStyle = C.rule;
        ctx.beginPath(); ctx.arc(cx, cy, sc * 2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        if (R) ctx.fillText("Detector is learning what normal looks like…", 12, h - 12);
      } else {
        const M = R.D.model;
        ellipse([M.mx, M.my], M.U, M.L, C.adapt, [6, 5], !!R.reveal);
        ctx.fillText(R.reveal ? "Teal: normal, learned by SVD (with principal axes)" : "Dashed: what the detector learned as normal", 12, h - 12);
        if (R.reveal && R.D.firedWin) {
          const m = meanCov(R.D.firedWin), sv = svd2x2(m.a, m.b, m.d);
          ellipse([m.mx, m.my], sv.U, sv.L, C.fail, [3, 4], false);
          ctx.fillStyle = C.fail; ctx.fillText(`Red: the last ${WIN} points when it fired (${R.D.why})`, 12, h - 30);
        }
      }
      if (!R) return;
      const now = R.now;
      for (let j = 0; j < R.shown; j++) {
        const p = R.stream[j];
        const age = now - p.t;
        if (age > FADE || age < 0) continue;
        const after = R.reveal && p.t >= R.change;
        ctx.globalAlpha = 0.25 + 0.75 * (1 - age / FADE);
        ctx.fillStyle = after ? C.fail : C.adapt;
        ctx.beginPath(); ctx.arc(cx + p.v[0] * sc, cy - p.v[1] * sc, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function tick(now) {
      if (!R || R.over) return;
      const t = (now - t0) / 1000;
      R.now = t;
      while (R.shown < R.stream.length && R.stream[R.shown].t <= t) { R.D.push(R.stream[R.shown]); R.shown++; }
      draw();
      if (t >= R.end) return endRound(null);
      raf = requestAnimationFrame(tick);
    }

    function startRound() {
      R = makeRound(G.round);
      roundBox.hidden = true; intro.hidden = true; result.hidden = true;
      hudRound.textContent = `Round ${G.round + 1} of ${ROUNDS.length}`;
      btnShift.disabled = false; root.querySelector(".game").focus({ preventScroll: true });
      live.textContent = `Round ${G.round + 1}. Watch the cloud and press Shift when it changes.`;
      t0 = performance.now(); raf = requestAnimationFrame(tick);
    }

    function endRound(tapTime) {
      R.over = true; cancelAnimationFrame(raf);
      for (let j = R.shown; j < R.stream.length; j++) R.D.push(R.stream[j]);   // let the detector see the rest of the round
      R.det = R.D.fired;
      btnShift.disabled = true;
      R.tap = tapTime; R.reveal = true; R.now = Math.min(R.now, R.end); draw();
      let you, cls;
      if (tapTime === null) { you = "Missed it"; cls = "miss"; }
      else if (tapTime < R.change) { you = "Too early: nothing had changed yet"; cls = "false"; }
      else {
        const d = tapTime - R.change, beat = R.det === null || R.det < R.change || d < R.det - R.change;
        if (d > 4) { you = `Too slow: ${fmt(d)} s (catch it within 4 s)`; cls = "miss"; }
        else { you = `Caught it in ${fmt(d)} s${beat ? ", faster than the detector!" : ""}`; cls = "hit"; }
      }
      let det;
      if (R.det === null) det = "Missed it";
      else if (R.det < R.change) det = "False alarm";
      else det = `${fmt(R.det - R.change)} s after the change`;
      G.res.push({ cls, delay: cls === "hit" ? tapTime - R.change : null, det: R.det !== null && R.det >= R.change ? R.det - R.change : null, detFalse: R.det !== null && R.det < R.change });
      roundBox.querySelector("[data-what]").textContent = `Round ${G.round + 1}: ${R.cfg.hint}. Red dots arrived after the change.`;
      roundBox.querySelector("[data-you]").textContent = you;
      roundBox.querySelector("[data-you]").className = "v " + cls;
      roundBox.querySelector("[data-det]").textContent = det;
      const last = G.round === ROUNDS.length - 1;
      roundBox.querySelector("[data-next] span").textContent = last ? "See results" : "Next round";
      roundBox.hidden = false;
      live.textContent = `You: ${you}. Detector: ${det}.`;
      roundBox.querySelector("[data-next]").focus({ preventScroll: true });
    }

    function next() {
      if (G.round === ROUNDS.length - 1) return finish();
      G.round++; startRound();
    }

    function finish() {
      roundBox.hidden = true;
      const hits = G.res.filter(r => r.cls === "hit");
      const fa = G.res.filter(r => r.cls === "false").length;
      const miss = G.res.filter(r => r.cls === "miss").length;
      const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
      const you = avg(hits.map(r => r.delay));
      const detHits = G.res.filter(r => r.det !== null);
      const det = avg(detHits.map(r => r.det));
      const detFa = G.res.filter(r => r.detFalse).length;
      const beat = G.res.filter(r => r.cls === "hit" && (r.det === null || r.delay < r.det)).length;
      let verdict;
      if (hits.length >= 4) verdict = `You win! ${hits.length} of ${ROUNDS.length} shifts caught${beat ? `, and you beat the detector ${beat} time${beat === 1 ? "" : "s"}` : ""}.`;
      else if (fa >= 2) verdict = "Too quick on the trigger. Wait until the dots really land somewhere new.";
      else verdict = "Some shifts slipped past. Watch where new dots land compared with the dashed ellipse.";
      result.querySelector("[data-summary]").innerHTML =
        `<li><span>You</span><b>${hits.length}/${ROUNDS.length} caught</b> · avg delay ${you === null ? "–" : fmt(you) + " s"} · ${fa} false alarm${fa === 1 ? "" : "s"}</li>` +
        `<li><span>SVD detector</span><b>${detHits.length}/${ROUNDS.length} caught</b> · avg delay ${det === null ? "–" : fmt(det) + " s"} · ${detFa} false alarm${detFa === 1 ? "" : "s"}</li>`;
      result.querySelector("[data-verdict]").textContent = verdict;
      result.hidden = false;
      hudRound.textContent = "Done";
      live.textContent = `Finished. You caught ${hits.length} of ${ROUNDS.length}.`;
    }

    function start() { G = { round: 0, res: [] }; startRound(); }
    function press() {
      if (!R || R.over) return;
      endRound(R.now);
    }

    btnStart.addEventListener("click", start);
    root.querySelector("[data-again]").addEventListener("click", start);
    root.querySelector("[data-next]").addEventListener("click", next);
    btnShift.addEventListener("click", press);
    canvas.addEventListener("pointerdown", e => { if (R && !R.over) { e.preventDefault(); press(); } });
    document.addEventListener("keydown", e => {
      if (!(R && !R.over) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); if (!e.repeat) press(); }
    });
    btnShift.disabled = true;
    draw();
  })();
})();
