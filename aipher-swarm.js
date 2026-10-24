/*! Aipher Swarm 1.0
 *  Enjambre de partículas que representa a Aipher. Sin dependencias (Canvas 2D).
 *
 *  Uso rápido:
 *    const swarm = AipherSwarm.create(document.querySelector('canvas'));
 *    swarm.setState('think');   // listen | think | speak | happy | surprise | confuse | rest
 *    swarm.setLevel(0.6);       // 0..1: volumen de la voz o del micrófono
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AipherSwarm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAU = Math.PI * 2, NS = 720;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, k) => a + (b - a) * k;
  const lerpH = (a, b, k) => { const d = ((b - a + 540) % 360) - 180; return (a + d * k + 360) % 360; };
  const hsla = (h, s, l, a) => 'hsla(' + (((h % 360) + 360) % 360 | 0) + ',' + s + '%,' + (l | 0) + '%,' + clamp(a, 0, 1).toFixed(2) + ')';

  /* Estados: color (h1→h2), ritmo, desorden, brillo, tamaño y forma que adopta el enjambre. */
  const STATES = {
    listen:   { h1: 28,  h2: 48,  speed: 1.0,  wobble: 0,   br: 1.0,  sz: 1.0,  shape: 'sphere' },
    think:    { h1: 318, h2: 16,  speed: 2.0,  wobble: .15, br: 1.05, sz: 1.0,  shape: 'torus'  },
    speak:    { h1: 8,   h2: 42,  speed: 1.3,  wobble: 0,   br: 1.1,  sz: 1.04, shape: 'sphere' },
    happy:    { h1: 44,  h2: 332, speed: 1.7,  wobble: 0,   br: 1.2,  sz: 1.0,  shape: 'heart'  },
    surprise: { h1: 346, h2: 54,  speed: 1.4,  wobble: .2,  br: 1.25, sz: 1.15, shape: 'galaxy' },
    confuse:  { h1: 18,  h2: 285, speed: 1.1,  wobble: 1,   br: .95,  sz: 1.0,  shape: 'cloud'  },
    rest:     { h1: 22,  h2: 8,   speed: .35,  wobble: 0,   br: .5,   sz: .62,  shape: 'sphere' }
  };

  /* Formas "hogar": a cada partícula se le asigna un punto en cada forma (se generan una sola vez). */
  const SHAPES = (() => {
    let s = 23; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const H = {}; ['sphere', 'torus', 'galaxy', 'heart', 'cloud'].forEach(k => { H[k] = new Float32Array(NS * 3); });
    const set = (k, i, x, y, z) => { H[k][i * 3] = x; H[k][i * 3 + 1] = y; H[k][i * 3 + 2] = z; };
    for (let i = 0; i < NS; i++) {
      const y = 1 - 2 * (i + .5) / NS, r = Math.sqrt(1 - y * y), t = i * 2.39996, u = .88 + .12 * rnd();
      set('sphere', i, Math.cos(t) * r * u, y * u, Math.sin(t) * r * u);
      { const A = rnd() * TAU, B = rnd() * TAU, r0 = .3 * (.7 + .3 * rnd());
        set('torus', i, (.68 + r0 * Math.cos(B)) * Math.cos(A), r0 * Math.sin(B), (.68 + r0 * Math.cos(B)) * Math.sin(A)); }
      { const arm = i % 3, tt = Math.pow(rnd(), .6), rr = .1 + tt * .95, aa = arm * TAU / 3 + tt * 3.2 + (rnd() - .5) * .35;
        set('galaxy', i, Math.cos(aa) * rr, (rnd() - .5) * .12 * (1 - tt), Math.sin(aa) * rr); }
      { const tt = rnd() * TAU, uu = Math.sqrt(rnd());
        set('heart', i, Math.pow(Math.sin(tt), 3) * uu * .95,
          -(13 * Math.cos(tt) - 5 * Math.cos(2 * tt) - 2 * Math.cos(3 * tt) - Math.cos(4 * tt)) / 17 * uu * .95, (rnd() - .5) * .5 * uu); }
      { const a = rnd() * TAU, b = Math.acos(2 * rnd() - 1), rr = .9 * Math.cbrt(rnd());
        set('cloud', i, rr * Math.sin(b) * Math.cos(a), rr * Math.cos(b), rr * Math.sin(b) * Math.sin(a)); }
    }
    return H;
  })();

  /* Toma n puntos repartidos uniformemente de una forma (para usar menos partículas sin deformarla). */
  function reduce(key, n) {
    const src = SHAPES[key], out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const j = Math.floor(i * NS / n) * 3; out[i * 3] = src[j]; out[i * 3 + 1] = src[j + 1]; out[i * 3 + 2] = src[j + 2]; }
    return out;
  }

  function create(canvas, options) {
    const opts = Object.assign({
      particles: 520, minParticles: 140, maxParticles: NS,
      maxDpr: 2, radius: .36,          // radio del enjambre como fracción del lado menor
      bind: true, popOnTap: true,      // usa el puntero del canvas y reacciona al toque
      autoQuality: true, autoVoice: true,
      background: null, autoStart: true, state: 'listen', onStats: null
    }, options || {});
    const g = canvas.getContext('2d');
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    let N = 0, pos, vel, sx, sy, psx, psy, lvl, kS, blend, homeA, homeB, morph = 1, shape = 'cloud', first = true;
    const S = { h1: 28, h2: 48, speed: 1, wobble: 0, br: 1, sz: 1, amp: 0, pop: 0, ph: 0 };
    let T = STATES.listen, state = 'listen';
    const ptr = { x: 0, y: 0, tx: 0, ty: 0, act: 0, actT: 0, fx: 0, fy: 0 };
    let level = 0, levelAt = -1e9, t = 0, raf = 0, running = false, visible = true, W = 0, H = 0, dprScale = 1;
    let seed = 2463534242, last = 0, fAcc = 0, fN = 0, slow = 0, fast = 0, target = opts.particles;
    let styles = new Array(12), streaks = new Array(3), sizes = [0, 0, 0, 0], palKey = '';

    const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

    function alloc(n) {
      n = clamp(Math.round(n), opts.minParticles, opts.maxParticles);
      if (n === N) return;
      const oldN = N, op = pos, ov = vel, cl = reduce('cloud', n);
      pos = new Float32Array(n * 3); vel = new Float32Array(n * 3);
      for (let i = 0; i < n * 3; i++) { pos[i] = i < oldN * 3 ? op[i] : cl[i]; vel[i] = i < oldN * 3 ? ov[i] : 0; }
      sx = new Float32Array(n); sy = new Float32Array(n); psx = new Float32Array(n); psy = new Float32Array(n);
      lvl = new Uint8Array(n); kS = new Float32Array(n); for (let i = 0; i < n; i++) kS[i] = 3 + (i % 5);
      blend = new Float32Array(n * 3); homeB = reduce(shape, n); homeA = homeB; morph = 1; N = n; first = true;
    }

    function setState(name) {
      const st = STATES[name]; if (!st) return;
      if (name !== state) S.pop = Math.max(S.pop, name === 'surprise' ? 1.7 : 1);
      state = name; T = st;
      if (st.shape !== shape) {
        if (morph < 1) { const e = morph * morph * (3 - 2 * morph); for (let i = 0; i < N * 3; i++) blend[i] = homeA[i] + (homeB[i] - homeA[i]) * e; homeA = blend.slice(); }
        else homeA = homeB;
        homeB = reduce(st.shape, N); morph = 0; shape = st.shape;
      }
    }

    function palette() {
      const key = (S.h1 | 0) + '|' + (S.h2 | 0) + '|' + Math.round(S.br * 50);
      if (key === palKey) return; palKey = key;
      for (let b = 0; b < 3; b++) {
        const h = lerpH(S.h1, S.h2, b / 2);
        for (let l = 0; l < 4; l++) { const d = (l + .5) / 4; styles[b * 4 + l] = hsla(h, 100, 66 + 14 * d, (.35 + .65 * d) * S.br); }
        streaks[b] = hsla(h, 100, 66, .4 * S.br);
      }
      for (let l = 0; l < 4; l++) sizes[l] = .008 + .012 * (l + .5) / 4;
    }

    function glow(x, y, r, h, l, a) {
      if (a < .01) return;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, hsla(h, 100, l, a)); gr.addColorStop(.35, hsla(h, 100, l - 14, a * .4)); gr.addColorStop(1, hsla(h, 100, l - 30, 0));
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    function step(dt) {
      const k = 1 - Math.exp(-dt * 5);
      S.h1 = lerpH(S.h1, T.h1, k); S.h2 = lerpH(S.h2, T.h2, k);
      S.speed = lerp(S.speed, T.speed, k); S.wobble = lerp(S.wobble, T.wobble, k); S.br = lerp(S.br, T.br, k); S.sz = lerp(S.sz, T.sz, k);
      S.ph += dt * S.speed * (reduced ? .5 : 1); S.pop *= Math.exp(-dt * 3.5); t += dt;
      ptr.act += (ptr.actT - ptr.act) * (1 - Math.exp(-dt * 7));
      ptr.x += (ptr.tx - ptr.x) * (1 - Math.exp(-dt * 14)); ptr.y += (ptr.ty - ptr.y) * (1 - Math.exp(-dt * 14));
      const kf = 1 - Math.exp(-dt * 5); ptr.fx += ((ptr.actT ? ptr.tx : 0) - ptr.fx) * kf; ptr.fy += ((ptr.actT ? ptr.ty : 0) - ptr.fy) * kf;

      /* nivel de voz: externo si lo hay; si no, uno sintético al hablar */
      let tAmp;
      if (t - levelAt < .35) tAmp = level;
      else if (state === 'speak' && opts.autoVoice) tAmp = (Math.sin(t * 1.3) > -.3 ? 1 : .2) * Math.pow(Math.abs(Math.sin(t * 8.3) * Math.sin(t * 3.1 + 1)), .7) * .85;
      else if (state === 'listen') tAmp = .1 + .1 * Math.abs(Math.sin(t * 5) * Math.sin(t * 2.1));
      else tAmp = state === 'think' ? .06 : 0;
      S.amp = lerp(S.amp, tAmp, 1 - Math.exp(-dt * 18));

      let H = homeB;
      if (morph < 1) {
        morph = Math.min(1, morph + dt * 1.1); const e = morph * morph * (3 - 2 * morph);
        for (let i = 0, n = N * 3; i < n; i++) blend[i] = homeA[i] + (homeB[i] - homeA[i]) * e;
        H = morph < 1 ? blend : homeB;
      }
      const sc = S.sz * (1 + .12 * S.amp) * (1 + 1.1 * S.pop), damp = Math.exp(-dt * 2.2),
        jit = (.25 + S.wobble * 2 + S.amp * 3) * dt, sw = .7 * S.speed * dt * (reduced ? .5 : 1),
        pa = ptr.act > .02, px = ptr.x, py = ptr.y, pf = 2.4 * ptr.act * dt;
      for (let i = 0; i < N; i++) {
        const i3 = i * 3, x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2], kd = kS[i] * dt;
        let vx = vel[i3] * damp + (H[i3] * sc - x) * kd - z * sw + (rnd() - .5) * jit,
            vy = vel[i3 + 1] * damp + (H[i3 + 1] * sc - y) * kd + (rnd() - .5) * jit,
            vz = vel[i3 + 2] * damp + (H[i3 + 2] * sc - z) * kd + x * sw + (rnd() - .5) * jit;
        if (pa) { const dx = px - x, dy = py - y, d = Math.sqrt(dx * dx + dy * dy); if (d < .9) { const f = (1 - d / .9) * pf; vx += dx * f; vy += dy * f; } }
        vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
        pos[i3] = x + vx * dt * 6; pos[i3 + 1] = y + vy * dt * 6; pos[i3 + 2] = z + vz * dt * 6;
      }
    }

    function render() {
      const R = Math.min(W, H) * opts.radius * (1 + .04 * S.pop), Rp = R * .85,
        cx = W / 2 + ptr.fx * R * .05 + Math.sin(S.ph * .57) * R * .012,
        cy = H / 2 + Math.sin(S.ph * .8) * R * .02 + ptr.fy * R * .04;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
      if (opts.background) { g.fillStyle = opts.background; g.fillRect(0, 0, W, H); }
      g.globalCompositeOperation = 'lighter'; palette();
      g.setTransform(1, 0, 0, .14, cx, cy + R * 1.14); glow(0, 0, R * 1.05, S.h1, 50, .5 * S.br);
      g.setTransform(1, 0, 0, 1, cx, cy); glow(0, 0, R * 1.25, S.h1, 50, .3 * S.br);

      const ay = S.ph * .25 + ptr.fx * .5, ax = .3 + ptr.fy * .3, ca = Math.cos(ax), sa = Math.sin(ax), cb = Math.cos(ay), sb = Math.sin(ay);
      for (let i = 0; i < N; i++) {
        const i3 = i * 3, x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2],
          y1 = y * ca - z * sa, z1 = y * sa + z * ca, x2 = x * cb + z1 * sb, z2 = -x * sb + z1 * cb, s = 1 + z2 * .25;
        sx[i] = x2 * Rp * s; sy[i] = y1 * Rp * s; lvl[i] = Math.min(3, clamp(z2 * .5 + .5, 0, .999) * 4 | 0);
      }
      if (first) { psx.set(sx); psy.set(sy); first = false; }

      g.lineWidth = Math.max(1, R * .006); const lim = R * .4;
      for (let b = 0; b < 3; b++) {
        g.strokeStyle = streaks[b]; g.beginPath();
        for (let i = b; i < N; i += 3) {
          const a = Math.abs(sx[i] - psx[i]) + Math.abs(sy[i] - psy[i]);
          if (a > .6 && a < lim) { g.moveTo(psx[i], psy[i]); g.lineTo(sx[i], sy[i]); }
        }
        g.stroke();
      }
      for (let b = 0; b < 3; b++) for (let l = 0; l < 4; l++) {
        g.fillStyle = styles[b * 4 + l]; const z = sizes[l] * R, h = z / 2;
        for (let i = b; i < N; i += 3) if (lvl[i] === l) g.fillRect(sx[i] - h, sy[i] - h, z, z);
      }
      psx.set(sx); psy.set(sy);
      glow(0, 0, R * .2 * S.sz, S.h2, 70, .3 * S.br);
      g.globalCompositeOperation = 'source-over';
    }

    function adapt(fps) {
      if (!opts.autoQuality) return;
      if (fps < 44) { slow++; fast = 0; } else if (fps > 57) { fast++; slow = 0; } else { slow = 0; fast = 0; }
      if (slow >= 2) { slow = 0; if (N > opts.minParticles) alloc(N * .8); else if (dprScale > .6) { dprScale -= .2; resize(); } }
      else if (fast >= 6) { fast = 0; if (dprScale < 1) { dprScale = Math.min(1, dprScale + .2); resize(); } else if (N < target) alloc(Math.min(target, N * 1.15)); }
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (!visible) { last = 0; return; }
      const dt = Math.min(.05, Math.max(0, (now - (last || now)) / 1000)); last = now;
      fAcc += dt; fN++;
      if (fAcc >= .5) { const fps = Math.round(fN / fAcc); fAcc = 0; fN = 0; adapt(fps); if (opts.onStats) opts.onStats({ fps, particles: N, dpr: dprScale }); }
      step(dt); render();
    }

    function resize() {
      const r = canvas.getBoundingClientRect(), d = Math.min((typeof devicePixelRatio === 'number' ? devicePixelRatio : 1), opts.maxDpr) * dprScale;
      W = canvas.width = Math.max(8, Math.round(r.width * d)); H = canvas.height = Math.max(8, Math.round(r.height * d));
    }

    function pointer(x, y, active) { ptr.tx = x; ptr.ty = y; ptr.actT = active ? 1 : 0; if (active && ptr.act < .02) { ptr.x = x; ptr.y = y; } }
    function fromEvent(e) { const r = canvas.getBoundingClientRect(), R = Math.min(r.width, r.height) * opts.radius; return [(e.clientX - r.left - r.width / 2) / R, (e.clientY - r.top - r.height / 2) / R]; }
    let down = false;
    const onDown = e => { down = true; const p = fromEvent(e); pointer(p[0], p[1], true); try { canvas.setPointerCapture(e.pointerId); } catch (_) {} if (opts.popOnTap) S.pop = Math.max(S.pop, 1.2); };
    const onMove = e => { if (e.pointerType === 'mouse' || down) { const p = fromEvent(e); pointer(p[0], p[1], true); } };
    const onUp = () => { down = false; ptr.actT = 0; };
    if (opts.bind && canvas.addEventListener) {
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('pointerleave', onUp);
    }
    let ro = null, io = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(resize); ro.observe(canvas); }
    if (typeof IntersectionObserver === 'function') { io = new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; }); io.observe(canvas); }

    target = reduced ? Math.min(opts.particles, 320) : opts.particles;
    alloc(target); resize(); setState(opts.state);

    const api = {
      setState, getState: () => state,
      setLevel(v) { level = clamp(+v || 0, 0, 1); levelAt = t; },
      pop(v) { S.pop = Math.max(S.pop, v == null ? 1 : v); },
      pointer, resize,
      start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(loop); } },
      stop() { running = false; cancelAnimationFrame(raf); },
      destroy() {
        api.stop(); if (ro) ro.disconnect(); if (io) io.disconnect();
        if (opts.bind && canvas.removeEventListener) { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('pointerleave', onUp); }
      },
      frame(dt) { step(dt == null ? 1 / 60 : dt); render(); },      // avance manual (útil para pruebas o capturas)
      get particles() { return N; }
    };
    if (opts.autoStart) api.start();
    return api;
  }

  return { create, STATES, SHAPES };
});
