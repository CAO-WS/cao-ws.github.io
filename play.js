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
        const btnSafe = root.querySelector("[data-safe]");
    const hudTime = root.querySelector("[data-time]");
    const hudScore = root.querySelector("[data-score]");
    const hudState = root.querySelector("[data-state]");
    const live = root.querySelector("[data-live]");
    const intro = root.querySelector(".kir-intro");
    const result = root.querySelector(".kir-result");

    const DURATION = 45;          // seconds
    const DT = 1 / 30;            // simulation step
    const WINDOW = 20;            // seconds visible on the chart
    const USERS_PER_S = 20;
    const ADAPT_DELAY = 1.2;      // retraining time
    const FORGET = 0.82;          // what fraction of old knowledge survives each update
    const ACC_GOOD = 0.88;        // "nothing is wrong" level for judging alarms

    let S = null, raf = null, last = 0, acc = 0;
    const ASPECT = w => (w < 600 ? 0.62 : 0.42);
    let dims = setupCanvas(canvas, ASPECT);
    window.addEventListener("resize", () => { dims = setupCanvas(canvas, ASPECT); draw(S && S.done); });

    // A run's hidden world: piecewise environment e(t) and short "glitch" windows of noisy telemetry.
    function makeWorld() {
      const A = 0.2, B = rand(0.5, 0.6), Cc = rand(0.82, 0.9);
      const t1 = rand(5, 7), t2 = t1 + rand(5, 6), t3 = t2 + rand(4, 5), t4 = t3 + rand(7, 9);
      const segs = [
        { from: 0, to: t1, kind: "stable", a: A, b: A, label: "Original conditions" },
        { from: t1, to: t2, kind: "gradual", a: A, b: B, label: "Gradual drift" },
        { from: t2, to: t3, kind: "stable", a: B, b: B, label: "New normal" },
        { from: t3, to: t4, kind: "sudden", a: Cc, b: Cc, label: "Sudden shift" },
        { from: t4, to: DURATION + 1, kind: "return", a: A, b: A, label: "Original conditions return" }
      ];
      const glitches = [{ from: rand(1.5, 3.5), len: 1.8 }, { from: t2 + rand(0.8, 2), len: 1.6 }];
      return { segs, glitches, A };
    }
    function envAt(world, t) {
      for (const s of world.segs) if (t >= s.from && t < s.to) {
        const f = s.to - s.from;
        return s.a + (s.b - s.a) * clamp((t - s.from) / f, 0, 1);
      }
      return world.A;
    }
    function glitchAt(world, t) { return world.glitches.some(g => t >= g.from && t < g.from + g.len); }

    function trueAcc(know, e) {
      let best = 0;
      for (const k of know) best = Math.max(best, k.w * Math.exp(-Math.pow((e - k.r) / 0.13, 2)));
      return 0.55 + 0.4 * best;
    }

    function reset() {
      S = {
        world: makeWorld(), t: 0, know: [{ r: 0.2, w: 1 }],
        obs: [], ema: 0.95, alarm: false, safe: false, pendingAdapt: null,
        events: [], falseAlarms: 0, adapts: 0, missed: 0, safeTime: 0,
        util: 0, users: 0, wrong: 0, deferred: 0, returnAcc: [], done: false
      };
    }

    function log(kind, text) { S.events.push({ t: S.t, kind }); if (text) say(text); }
    function say(t) { live.textContent = t; }

    function step() {
      const w = S.world;
      const e = envAt(w, S.t);
      if (S.pendingAdapt && S.t >= S.pendingAdapt.at) {
        for (const k of S.know) k.w *= FORGET;
        S.know = S.know.filter(k => k.w > 0.04);
        S.know.push({ r: S.pendingAdapt.e, w: 1 });
        S.pendingAdapt = null;
        say("Update deployed.");
      }
      const a = trueAcc(S.know, e);
      const noise = glitchAt(w, S.t) ? 0.08 : 0.03;
      const o = clamp(a + gauss() * noise, 0.3, 1);
      S.ema += (o - S.ema) * 0.12;
      S.obs.push({ t: S.t, o: S.ema, a });

      const n = USERS_PER_S * DT;
      S.users += n;
      if (S.safe) { S.util += 0.5 * n; S.deferred += n; S.safeTime += DT; }
      else { S.util += (a - (1 - a)) * n; S.wrong += (1 - a) * n; }
      if (a < 0.8 && !S.alarm && !S.safe && !S.pendingAdapt) S.missed += DT;
      const seg = w.segs[w.segs.length - 1];
      if (S.t >= seg.from + 1.5) S.returnAcc.push(a);
      S.t += DT;
    }

    function score() {
      const s = 100 * S.util / (S.users * 0.9 || 1) - 2 * S.falseAlarms;
      return Math.round(clamp(s, 0, 100));
    }

    function hud() {
      hudTime.textContent = Math.max(0, Math.ceil(DURATION - S.t)) + " s";
      hudScore.textContent = S.users > 0 ? score() : "–";
      let st = "All good: keep watching";
      const low = S.obs.length && S.obs[S.obs.length - 1].o < 0.8;
      if (S.done) st = "Shift over";
      else if (S.pendingAdapt) st = "Retraining the model…";
      else if (S.safe) st = "Safe mode: users are waiting";
      else if (low) st = "Below the line: press Catch & fix!";
      hudState.textContent = st;
      hudState.classList.toggle("warn", !!low && !S.pendingAdapt && !S.safe && !S.done);
      btnCatch.disabled = !!S.pendingAdapt || S.done;
      btnSafe.disabled = S.done;
      btnSafe.setAttribute("aria-pressed", S.safe ? "true" : "false");
      btnSafe.querySelector("span").textContent = S.safe ? "Resume serving" : "Safe mode";
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

      // revealed regimes as background bands
      if (S && reveal) {
        const cols = { stable: "#EEF1F4", gradual: "#FBF0D9", sudden: "#F7E1DC", return: "#E3EEF0" };
        for (const s of S.world.segs) {
          const a = X(Math.max(s.from, t0)), b = X(Math.min(s.to, t1));
          if (b <= a) continue;
          ctx.fillStyle = cols[s.kind]; ctx.fillRect(a, padT, b - a, H);
        }
      }
      // grid
      ctx.strokeStyle = "#E4E9EE"; ctx.lineWidth = 1; ctx.fillStyle = C.ink2; ctx.font = "12px Schibsted Grotesk, system-ui, sans-serif";
      for (const v of [0.5, 0.7, 0.9]) {
        ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(w - padR, Y(v)); ctx.stroke();
        ctx.fillText(Math.round(v * 100) + "%", 4, Y(v) + 4);
      }
      // threshold
      ctx.setLineDash([6, 6]); ctx.strokeStyle = C.catch; ctx.globalAlpha = .8;
      ctx.beginPath(); ctx.moveTo(padL, Y(0.8)); ctx.lineTo(w - padR, Y(0.8)); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = C.catch; ctx.fillText("alert level", w - padR - 62, Y(0.8) - 6);

      if (!S) return;
      // observed (smoothed) accuracy
      ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
      let prev = null;
      for (const p of S.obs) {
        if (p.t < t0) continue;
        const x = X(p.t), y = Y(clamp(p.o, 0.4, 1));
        if (prev) {
          ctx.strokeStyle = p.o < 0.8 ? C.fail : C.ink;
          ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(x, y); ctx.stroke();
        }
        prev = [x, y];
      }
      // true accuracy (only after the run)
      if (reveal) {
        ctx.strokeStyle = C.adapt; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath();
        S.obs.forEach((p, i) => { const x = X(p.t), y = Y(clamp(p.a, 0.4, 1)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke(); ctx.setLineDash([]);
      }
      // event markers
      const mk = { catch: C.adapt, adapt: C.adapt, safe: C.operate, unsafe: C.operate, false: C.fail };
      for (const ev of S.events) {
        if (ev.t < t0) continue;
        const x = X(ev.t);
        ctx.strokeStyle = mk[ev.kind] || C.ink; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + H); ctx.stroke();
        ctx.fillStyle = mk[ev.kind] || C.ink;
        const lab = { catch: "✓", adapt: "A", safe: "S", unsafe: "S", false: "✕" }[ev.kind];
        ctx.beginPath(); ctx.arc(x, padT + 9, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 10px Schibsted Grotesk, system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(lab, x, padT + 12.5); ctx.textAlign = "left";
      }
      // time axis
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
      root.classList.add("playing");
      last = performance.now(); acc = 0; hud(); draw();
      say("Shift started. Press Space when the line drops below the dashed line.");
      root.querySelector(".game").focus({ preventScroll: true });
      raf = requestAnimationFrame(loop);
    }

    function doCatch() {
      if (!S || S.done || S.pendingAdapt) return;
      const a = trueAcc(S.know, envAt(S.world, S.t));
      if (a >= ACC_GOOD) { S.falseAlarms++; log("false", "False alarm: that was just noise. −2 points."); hud(); return; }
      log("catch");
      S.adapts++;
      S.pendingAdapt = { at: S.t + ADAPT_DELAY, e: envAt(S.world, S.t) };
      say("Caught it. Retraining on recent data…");
      hud();
    }
    function doSafe() {
      if (!S || S.done) return;
      S.safe = !S.safe; log(S.safe ? "safe" : "unsafe", S.safe ? "Safe mode on: users are deferred, no errors." : "Back to serving users.");
      hud();
    }

    function finish() {
      S.done = true; cancelAnimationFrame(raf); root.classList.remove("playing");
      hud(); draw(true);
      const sc = score();
      const lessons = [];
      const retAcc = S.returnAcc.length ? S.returnAcc.reduce((x, y) => x + y, 0) / S.returnAcc.length : 1;
      if (retAcc < 0.75 && S.adapts > 0) lessons.push(`When the original conditions came back, the model had partly forgotten them (true accuracy about ${Math.round(retAcc * 100)}%). Each of your ${S.adapts} updates overwrote some old knowledge: catastrophic forgetting.`);
      else if (S.adapts >= 7) lessons.push(`You updated the model ${S.adapts} times. Frequent updates are costly and each one erodes what the model already knew.`);
      if (S.falseAlarms >= 1) lessons.push(`${S.falseAlarms} false alarm${S.falseAlarms > 1 ? "s" : ""}. Some wiggles were just noise, not real drift. Telling the two apart is the hard part of catching drift.`);
      if (S.missed >= 6) lessons.push(`Real degradation went unflagged for ${fmt(S.missed)} s. Gradual drift is hard to see on a noisy trace.`);
      if (S.safeTime >= 12) lessons.push(`You spent ${fmt(S.safeTime, 0)} s in safe mode. No errors, but ${Math.round(S.deferred)} users went unserved. Abstaining is a valid response, but it is not free.`);
      if (S.adapts === 0) lessons.push("You never retrained. Sometimes staying put is right, but here the world really did change.");
      if (!lessons.length) lessons.push("A clean run: you caught the real shifts, retrained only when needed, and kept serving users. That balance is exactly what CAO studies.");
      const grade = sc >= 80 ? "Reliable operator! You win." : sc >= 72 ? "Nicely done. You win." : sc >= 62 ? "Getting there" : "Rough shift";
      result.querySelector("[data-final]").textContent = sc;
      result.querySelector("[data-grade]").textContent = grade;
      result.querySelector("[data-stats]").innerHTML =
        `<li><b>${S.adapts}</b> retrains</li><li><b>${S.falseAlarms}</b> false alarms</li><li><b>${fmt(S.missed)} s</b> of unflagged drift</li><li><b>${fmt(S.safeTime, 0)} s</b> in safe mode</li>`;
      result.querySelector("[data-lessons]").innerHTML = lessons.map(l => `<li>${l}</li>`).join("");
      const share = result.querySelector("[data-share]");
      share.onclick = () => {
        const txt = `I kept a deployed model ${sc}% reliable in "Keep it running" at CAO 2027 (ICLR 2027 workshop proposal). ${location.href.split("#")[0]}#kir`;
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
          () => { share.querySelector("span").textContent = "Copied"; },
          () => { share.querySelector("span").textContent = "Copy failed"; });
      };
      share.querySelector("span").textContent = "Copy my score";
      result.hidden = false;
      say(`Run over. Score ${sc}. ${grade}.`);
    }

    btnStart.addEventListener("click", start);
    root.querySelector("[data-again]").addEventListener("click", start);
    btnCatch.addEventListener("click", doCatch);
    btnSafe.addEventListener("click", doSafe);
    document.addEventListener("keydown", ev => {
      if (!S || S.done || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((ev.target.tagName || ""))) return;
      const k = ev.key.toLowerCase();
      if (k === " " || k === "spacebar" || k === "c") { ev.preventDefault(); if (!ev.repeat) doCatch(); }
      if (k === "s") { ev.preventDefault(); doSafe(); }
    });
    [btnCatch, btnSafe].forEach(b => b.disabled = true);
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
    function detector(stream) {
      const k = 0.5, h = 22, kr = 1.2;
      let xp = 0, xn = 0, yp = 0, yn = 0, rp = 0;
      for (const p of stream) {
        const [x, y] = p.v;
        xp = Math.max(0, xp + x - k); xn = Math.max(0, xn - x - k);
        yp = Math.max(0, yp + y - k); yn = Math.max(0, yn - y - k);
        const z = (x * x + y * y - 2) / 2;
        rp = Math.max(0, rp + z - kr);
        if (xp > h || xn > h || yp > h || yn > h || rp > h) return p.t;
      }
      return null;
    }

    function makeRound(i) {
      const change = rand(3, 12), end = change + MISS_AFTER, cfg = ROUNDS[i];
      const stream = [];
      let t = 0;
      while (t < end) {
        t += -Math.log(Math.random()) / RATE;
        stream.push({ t, v: t < change ? [gauss(), gauss()] : cfg.gen() });
      }
      return { i, cfg, change, end, stream, det: detector(stream), tap: null, shown: 0 };
    }

    function draw() {
      const { ctx, w, h } = dims;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, sc = Math.min(w, h) / 9;
      ctx.strokeStyle = "#E4E9EE"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
      // reference ring: where "normal" data lives
      ctx.setLineDash([5, 5]); ctx.strokeStyle = C.rule;
      ctx.beginPath(); ctx.arc(cx, cy, sc * 2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
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
      while (R.shown < R.stream.length && R.stream[R.shown].t <= t) R.shown++;
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
      else verdict = "Some shifts slipped past. Watch where new dots land compared with the dashed ring.";
      result.querySelector("[data-summary]").innerHTML =
        `<li><span>You</span><b>${hits.length}/${ROUNDS.length} caught</b> · avg delay ${you === null ? "–" : fmt(you) + " s"} · ${fa} false alarm${fa === 1 ? "" : "s"}</li>` +
        `<li><span>Drift detector (CUSUM)</span><b>${detHits.length}/${ROUNDS.length} caught</b> · avg delay ${det === null ? "–" : fmt(det) + " s"} · ${detFa} false alarm${detFa === 1 ? "" : "s"}</li>`;
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
