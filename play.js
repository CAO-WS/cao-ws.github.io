/* CAO 2027 mini-game: "Keep it running".
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
    const ADAPT_DELAY = 0.5;      // retraining time
    const FORGET = 0.9;           // fraction of old knowledge that survives each update
    const ACC_GOOD = 0.88;        // above this, nothing is really wrong (an alarm is false)
    const LINE = 0.8;             // the alert line

    let S = null, raf = null, last = 0, acc = 0;
    const ASPECT = w => (w < 600 ? 0.62 : 0.42);
    let dims = setupCanvas(canvas, ASPECT);
    window.addEventListener("resize", () => { dims = setupCanvas(canvas, ASPECT); draw(S && S.done); });

    // Hidden world, different every run: a random starting condition, then 3-5 random events
    // (gradual drift, sudden shift, return to the original conditions, or a brief blip that fixes itself)
    // with random sizes, directions and timing, plus 1-2 fake dips in the monitoring data.
    function makeWorld() {
      const A = rand(0.2, 0.8);
      const far = x => { let y; do { y = rand(0.05, 0.95); } while (Math.abs(y - x) < 0.3); return y; };
      const events = [];
      let cur = A, t = rand(3, 5);
      while (t < 24.5) {
        let kind;
        if (Math.abs(cur - A) > 0.15 && Math.random() < 0.4) kind = "return";
        else kind = ["gradual", "sudden", "sudden", "blip"][Math.floor(Math.random() * 4)];
        if (events.length < 2 && kind === "blip") kind = Math.random() < 0.5 ? "gradual" : "sudden";
        if (kind === "gradual") { const to = far(cur), d = rand(2.5, 4); events.push({ kind, from: t, ramp: d, a: cur, b: to, end: t + d }); cur = to; t += d + rand(4.5, 7); }
        else if (kind === "sudden") { const to = far(cur); events.push({ kind, from: t, ramp: 0.05, a: cur, b: to, end: t }); cur = to; t += rand(5, 7.5); }
        else if (kind === "return") { events.push({ kind, from: t, ramp: 0.05, a: cur, b: A, end: t }); cur = A; t += rand(5, 7.5); }
        else { const d = rand(2, 3); events.push({ kind, from: t, ramp: 0.05, a: cur, b: far(cur), blip: d, end: t + d }); t += d + rand(4, 6); }
      }
      const glitches = [], ng = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < ng; i++) {
        let g, ok, tries = 0;
        do { g = rand(1.5, 27); ok = events.every(e => Math.abs(e.from - g) > 2) && glitches.every(h => Math.abs(h.from - g) > 3); } while (!ok && ++tries < 50);
        glitches.push({ from: g, len: rand(1, 1.5), bias: -rand(0.1, 0.16) });
      }
      return { A, events, glitches };
    }
    function envAt(world, t) {
      let v = world.A;
      for (const e of world.events) {
        if (t < e.from) break;
        v = e.kind === "blip" ? (t < e.from + e.blip ? e.b : e.a) : e.a + (e.b - e.a) * clamp((t - e.from) / e.ramp, 0, 1);
      }
      return v;
    }
    function glitchAt(world, t) { for (const g of world.glitches) if (t >= g.from && t < g.from + g.len) return g.bias; return 0; }
    function eventAt(world, t) { let cur = null; for (const e of world.events) if (t >= e.from) cur = e; return cur; }
    function trueAcc(know, e) {
      let best = 0;
      for (const k of know) best = Math.max(best, k.w * Math.exp(-Math.pow((e - k.r) / 0.13, 2)));
      return 0.55 + 0.4 * best;
    }

    function reset() {
      const world = makeWorld();
      // live: the model is serving users. After Catch it is pulled offline until you press Operate to release it.
      S = { world, t: 0, know: [{ r: world.A, w: 1 }], obs: [], ema: 0.95,
            live: true, adapted: false, readyAt: null, pending: null, events: [], offline: [],
            falseAlarms: 0, adapts: 0, missed: 0, offTime: 0, waitRelease: 0, up: 0, done: false };
    }
    function log(kind, text) { S.events.push({ t: S.t, kind }); if (text) say(text); }
    function say(t) { live.textContent = t; }

    function step() {
      const w = S.world, e = envAt(w, S.t);
      if (S.pending && S.t >= S.pending.at) {
        for (const k of S.know) k.w *= FORGET;
        S.know = S.know.filter(k => k.w > 0.04);
        S.know.push({ r: S.pending.e, w: 1 });
        S.pending = null; S.adapted = true; S.readyAt = S.t;
        say("Updated model ready. Press Operate to release it to users.");
      }
      const a = trueAcc(S.know, e);
      S.ema += (clamp(a + glitchAt(w, S.t) + gauss() * 0.03, 0.3, 1) - S.ema) * 0.12;
      S.obs.push({ t: S.t, o: S.ema, a });
      // Score: time users are served by a reliable model. Offline time counts half (no mistakes, but users wait).
      if (!S.live) { S.up += 0.5 * DT; S.offTime += DT; if (S.adapted) S.waitRelease += DT; S.offline[S.offline.length - 1].to = S.t; }
      else if (a >= LINE) S.up += DT;
      if (S.live && a < LINE) S.missed += DT;
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
      let st = "Live: serving users", warn = false;
      if (S.done) st = "Shift over";
      else if (S.pending) st = "Offline: retraining…";
      else if (!S.live && S.adapted) { st = "Updated model ready: press Operate to release it"; warn = true; }
      else if (!S.live) { st = "Offline, users waiting: press Adapt"; warn = true; }
      else if (low) { st = "Below the line: press Catch"; warn = true; }
      hudState.textContent = st;
      hudState.classList.toggle("warn", warn);
      btnCatch.disabled = S.done || !S.live;
      btnAdapt.disabled = S.done || S.live || !!S.pending;
      btnOperate.disabled = S.done || S.live || !!S.pending;
      btnCatch.classList.toggle("nudge", !btnCatch.disabled && !!low);
      btnAdapt.classList.toggle("nudge", !btnAdapt.disabled && !S.adapted);
      btnOperate.classList.toggle("nudge", !btnOperate.disabled && S.adapted);
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
      if (S) {   // grey bands: time the model was offline (pulled from users)
        ctx.fillStyle = "rgba(61,75,163,.08)";
        for (const o of S.offline) { const x0 = X(Math.max(o.from, t0)), x1 = X(Math.min(o.to, t1)); if (x1 > x0) ctx.fillRect(x0, padT, x1 - x0, H); }
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
      const mk = { catch: C.catch, adapt: C.adapt, operate: C.operate, false: C.fail };
      const lab = { catch: "C", adapt: "A", operate: "O", false: "✕" };
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
      const narrow = w < 560;
      ctx.fillText(reveal ? (narrow ? "Dashed: true accuracy. Blue: offline." : "Solid: what you saw. Dashed: true accuracy. Blue bands: model offline.")
                          : (narrow ? "Keep it above the line" : "model accuracy: keep it above the line (blue band = offline)"), padL, h - 6);
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
      if (!S || S.done || !S.live) return;
      const a = trueAcc(S.know, envAt(S.world, S.t));
      if (a >= ACC_GOOD) { S.falseAlarms++; log("false", "False alarm: the model was fine. −2 points."); hud(); return; }
      S.live = false; S.adapted = false; S.offline.push({ from: S.t, to: S.t });
      log("catch", "Caught. The model is pulled from users. Press Adapt.");
      hud();
    }
    function doAdapt() {
      if (!S || S.done || S.live || S.pending) return;
      S.adapts++; S.adapted = false;
      S.pending = { at: S.t + ADAPT_DELAY, e: envAt(S.world, S.t) };
      log("adapt", "Retraining on recent data…");
      hud();
    }
    function doOperate() {
      if (!S || S.done || S.live || S.pending) return;
      S.live = true; S.adapted = false;
      log("operate", "Released to users.");
      hud();
    }

    function finish() {
      S.done = true; cancelAnimationFrame(raf);
      hud(); draw(true);
      const sc = score();
      const lessons = [];
      if (S.falseAlarms >= 1) lessons.push(`${S.falseAlarms} false alarm${S.falseAlarms > 1 ? "s" : ""}: you pressed Catch when the model was actually fine.`);
      if (S.missed >= 4) lessons.push(`Users were served by a model below the line for ${fmt(S.missed)} s.`);
      if (S.waitRelease >= 3) lessons.push(`Updated models waited ${fmt(S.waitRelease)} s before you released them with Operate.`);
      if (!S.live) lessons.push("The model was still offline when time ran out.");
      if (S.adapts === 0) lessons.push("You never adapted.");
      if (!lessons.length) lessons.push("A clean run: you caught the drops, adapted, and released the model quickly.");
      const grade = sc >= 85 ? "Reliable operator! You win." : sc >= 70 ? "Nicely done. You win." : sc >= 55 ? "Getting there" : "Rough shift";
      result.querySelector("[data-final]").textContent = sc;
      result.querySelector("[data-grade]").textContent = grade;
      result.querySelector("[data-stats]").innerHTML =
        `<li><b>${S.adapts}</b> adaptations</li><li><b>${S.falseAlarms}</b> false alarms</li><li><b>${fmt(S.missed)} s</b> serving below the line</li><li><b>${fmt(S.offTime, 0)} s</b> offline</li>`;
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
      if (k === " " || k === "spacebar") { ev.preventDefault(); if (!ev.repeat) (S.live ? doCatch : (S.adapted ? doOperate : doAdapt))(); }
      else if (k === "c" || k === "1") { ev.preventDefault(); doCatch(); }
      else if (k === "a" || k === "2") { ev.preventDefault(); doAdapt(); }
      else if (k === "o" || k === "3") { ev.preventDefault(); doOperate(); }
    });
    [btnCatch, btnAdapt, btnOperate].forEach(b => b.disabled = true);
    draw();
  })();

})();
