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
      btnOperate.querySelector("span").textContent = S.safe ? "Resume" : "Operate";
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

})();
