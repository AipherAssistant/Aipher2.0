/*! Aipher Swarm 1.1
 *  Enjambre de partículas 3D que representa a Aipher. Sin dependencias (Canvas 2D).
 *
 *  Uso rápido:
 *    const swarm = AipherSwarm.create(document.querySelector('canvas'));
 *    swarm.setState('think');   // listen | think | speak | happy | surprise | confuse | rest
 *    swarm.setLevel(0.6);       // 0..1: volumen de la voz o del micrófono
 *
 *  Gestos (con bind:true):
 *    arrastrar          → gira el enjambre en 3D (con inercia)
 *    toque corto        → onda de choque que empuja las partículas
 *    mantener pulsado   → pozo de gravedad: las partículas orbitan tu dedo
 *    pellizcar / rueda  → zoom
 *    doble toque        → restablece la vista
 *    ratón encima       → repele suavemente las partículas
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AipherSwarm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAU = Math.PI * 2, NS = 720, LV = 6;
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
      maxDpr: 2, radius: .36,            // radio del enjambre como fracción del lado menor
      bind: true, popOnTap: true,        // gestos sobre el canvas y pulso al tocar
      haptics: true, tilt: false,        // vibración corta (Android) e inclinación del teléfono
      zoomRange: [.6, 1.8],
      autoQuality: true, autoVoice: true,
      background: null, autoStart: true, state: 'listen', onStats: null, onGesture: null
    }, options || {});
    const g = canvas.getContext('2d');
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    let N = 0, pos, vel, sx, sy, psx, psy, lvl, kS, blend, homeA, homeB, morph = 1, shape = 'cloud', first = true;
    const S = { h1: 28, h2: 48, speed: 1, wobble: 0, br: 1, sz: 1, amp: 0, pop: 0, ph: 0 };
    let T = STATES.listen, state = 'listen';
    const ptr = { x: 0, y: 0, tx: 0, ty: 0, act: 0, actT: 0, fx: 0, fy: 0 };
    const view = { yaw: 0, pitch: .3, vyaw: 0, vpitch: 0, zoom: 1, zt: 1 };
    const tilt = { yT: 0, pT: 0, y: 0, p: 0, on: false };
    const waves = [];
    let ctl = 0, dragging = false, holdOn = false, mouseHover = false, resetting = 0, yawTarget = 0;
    let level = 0, levelAt = -1e9, t = 0, raf = 0, running = false, visible = true, W = 0, H = 0, dprScale = 1;
    let seed = 2463534242, last = 0, fAcc = 0, fN = 0, slow = 0, fast = 0, target = opts.particles;
    let styles = new Array(3 * LV), bloom = new Array(3), streaks = new Array(3), sizes = new Array(LV), palKey = '';
    let ca = 1, sa = 0, cb = 1, sb = 0;

    const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    const gesture = type => { if (opts.onGesture) opts.onGesture({ type }); };
    const haptic = ms => { if (opts.haptics && typeof navigator !== 'undefined' && navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} } };

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
        for (let l = 0; l < LV; l++) { const d = (l + .5) / LV; styles[b * LV + l] = hsla(h, 100, 62 + 18 * d, (.2 + .8 * d) * S.br); }
        bloom[b] = hsla(h, 100, 70, .11 * S.br); streaks[b] = hsla(h, 100, 66, .4 * S.br);
      }
      for (let l = 0; l < LV; l++) sizes[l] = .006 + .017 * (l + .5) / LV;
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

      /* vista 3D: inercia al soltar, giro automático suave, retorno de la inclinación */
      ctl = (dragging || holdOn) ? 1 : Math.max(0, ctl - dt * .5);
      if (resetting > 0) {
        resetting -= dt; const kk = 1 - Math.exp(-dt * 7);
        view.yaw += (yawTarget - view.yaw) * kk; view.pitch += (.3 - view.pitch) * kk; view.vyaw = 0; view.vpitch = 0;
      } else if (!dragging) {
        view.yaw += (.25 * S.speed * (1 - ctl) * (reduced ? .5 : 1) + view.vyaw) * dt; view.vyaw *= Math.exp(-dt * 1.6);
        view.pitch = clamp(view.pitch + view.vpitch * dt, -1.2, 1.2); view.vpitch *= Math.exp(-dt * 2.2);
        view.pitch += (.3 - view.pitch) * (1 - Math.exp(-dt * .5)) * (1 - ctl);
      }
      view.zoom += (view.zt - view.zoom) * (1 - Math.exp(-dt * 8));
      const kt = 1 - Math.exp(-dt * 6); tilt.y += (tilt.yT - tilt.y) * kt; tilt.p += (tilt.pT - tilt.p) * kt;
      const ay = view.yaw + tilt.y + ptr.fx * .12, ax = view.pitch + tilt.p + ptr.fy * .1;
      ca = Math.cos(ax); sa = Math.sin(ax); cb = Math.cos(ay); sb = Math.sin(ay);

      for (let i = waves.length - 1; i >= 0; i--) { waves[i].t += dt; if (waves[i].t > 1.3) waves.splice(i, 1); }

      /* nivel de voz: externo si lo hay; si no, uno sintético al hablar */
      let tAmp;
      if (t - levelAt < .35) tAmp = level;
      else if (state === 'speak' && opts.autoVoice) tAmp = (Math.sin(t * 1.3) > -.3 ? 1 : .2) * Math.pow(Math.abs(Math.sin(t * 8.3) * Math.sin(t * 3.1 + 1)), .7) * .85;
      else if (state === 'listen') tAmp = .1 + .1 * Math.abs(Math.sin(t * 5) * Math.sin(t * 2.1));
      else tAmp = state === 'think' ? .06 : 0;
      S.amp = lerp(S.amp, tAmp, 1 - Math.exp(-dt * 18));

      let Hm = homeB;
      if (morph < 1) {
        morph = Math.min(1, morph + dt * 1.1); const e = morph * morph * (3 - 2 * morph);
        for (let i = 0, n = N * 3; i < n; i++) blend[i] = homeA[i] + (homeB[i] - homeA[i]) * e;
        Hm = morph < 1 ? blend : homeB;
      }
      const sc = S.sz * (1 + .12 * S.amp) * (1 + 1.1 * S.pop), damp = Math.exp(-dt * 2.2),
        jit = (.25 + S.wobble * 2 + S.amp * 3) * dt,
        sw = (.7 * S.speed * (reduced ? .5 : 1) + clamp(view.vyaw * .35, -1.5, 1.5)) * dt,   // el giro del usuario arrastra a las partículas
        invR = 1 / (Math.min(W, H) * opts.radius || 1),
        px = ptr.x, py = ptr.y,
        well = holdOn && ptr.act > .02, push = mouseHover && !dragging && !holdOn && ptr.act > .02, nW = waves.length;
      for (let i = 0; i < N; i++) {
        const i3 = i * 3, x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2], kd = kS[i] * dt;
        let vx = vel[i3] * damp + (Hm[i3] * sc - x) * kd - z * sw + (rnd() - .5) * jit,
            vy = vel[i3 + 1] * damp + (Hm[i3 + 1] * sc - y) * kd + (rnd() - .5) * jit,
            vz = vel[i3 + 2] * damp + (Hm[i3 + 2] * sc - z) * kd + x * sw + (rnd() - .5) * jit;
        /* fuerzas en el plano de la pantalla, convertidas al espacio 3D con la rotación inversa de la vista */
        let Fx = 0, Fy = 0, dm = 1;
        if (well || push || nW) {
          const ux = sx[i] * invR, uy = sy[i] * invR;
          if (well) { const dx = px - ux, dy = py - uy, d2 = dx * dx + dy * dy; if (d2 < 1.3) { const w = 1 - Math.sqrt(d2) / 1.14; Fx += (dx * 9 - dy * 6) * w * dt; Fy += (dy * 9 + dx * 6) * w * dt; dm = 1 - .1 * w; } }
          else if (push) { const dx = ux - px, dy = uy - py, d2 = dx * dx + dy * dy; if (d2 < .5) { const d = Math.sqrt(d2) + .02, w = (1 - d / .7) * dt * 5; Fx += dx / d * w; Fy += dy / d * w; } }
          for (let q = 0; q < nW; q++) {
            const wv = waves[q], dx = ux - wv.x, dy = uy - wv.y, d = Math.sqrt(dx * dx + dy * dy) + .001, e = (d - wv.t * 1.7) / .2, s = Math.exp(-e * e) * (1 - wv.t / 1.3) * dt * 8;
            if (s > .0005) { Fx += dx / d * s; Fy += dy / d * s; }
          }
        }
        if (Fx !== 0 || Fy !== 0) { vx += Fx * cb; vy += Fy * ca + Fx * sb * sa; vz += -Fy * sa + Fx * sb * ca; }
        if (dm !== 1) { vx *= dm; vy *= dm; vz *= dm; }       // amortiguación cerca del dedo: las partículas orbitan en vez de salir disparadas
        vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
        pos[i3] = x + vx * dt * 6; pos[i3 + 1] = y + vy * dt * 6; pos[i3 + 2] = z + vz * dt * 6;
      }
    }

    function render() {
      const Rb = Math.min(W, H) * opts.radius, R = Rb * (1 + .04 * S.pop), Rp = R * .85 * view.zoom,
        cx = W / 2 + ptr.fx * R * .03 + Math.sin(S.ph * .57) * R * .012,
        cy = H / 2 + Math.sin(S.ph * .8) * R * .02 + ptr.fy * R * .03;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
      if (opts.background) { g.fillStyle = opts.background; g.fillRect(0, 0, W, H); }
      g.globalCompositeOperation = 'lighter'; palette();
      g.setTransform(1, 0, 0, .14, cx, cy + R * 1.14 * (1 - .25 * Math.max(0, view.pitch - .3))); glow(0, 0, R * 1.05 * Math.sqrt(view.zoom), S.h1, 50, .5 * S.br);
      g.setTransform(1, 0, 0, 1, cx, cy); glow(0, 0, R * 1.25 * Math.sqrt(view.zoom), S.h1, 50, .3 * S.br);

      for (let i = 0; i < N; i++) {
        const i3 = i * 3, x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2],
          y1 = y * ca - z * sa, z1 = y * sa + z * ca, x2 = x * cb + z1 * sb, z2 = -x * sb + z1 * cb,
          s = 1 / Math.max(.55, 1 - z2 * .3);                                  // perspectiva
        sx[i] = x2 * Rp * s; sy[i] = y1 * Rp * s; lvl[i] = Math.min(LV - 1, clamp(z2 * .45 + .5, 0, .999) * LV | 0);
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
      for (let b = 0; b < 3; b++) {
        for (let l = 0; l < LV; l++) {
          g.fillStyle = styles[b * LV + l]; const z = sizes[l] * R, h = z / 2;
          for (let i = b; i < N; i += 3) if (lvl[i] === l) g.fillRect(sx[i] - h, sy[i] - h, z, z);
        }
        g.fillStyle = bloom[b]; const zb = sizes[LV - 1] * R * 2.6, hb = zb / 2;     // resplandor en las partículas más cercanas
        for (let i = b; i < N; i += 3) if (lvl[i] >= LV - 2) g.fillRect(sx[i] - hb, sy[i] - hb, zb, zb);
      }
      psx.set(sx); psy.set(sy);
      glow(0, 0, R * .2 * S.sz, S.h2, 70, .3 * S.br);

      for (let i = 0; i < waves.length; i++) {
        const w = waves[i], a = (1 - w.t / 1.3) * .5 * S.br;
        g.strokeStyle = hsla(S.h2, 100, 75, a); g.lineWidth = Math.max(1, R * .012 * (1 - w.t / 1.3));
        g.beginPath(); g.arc(w.x * Rb, w.y * Rb, w.t * 1.7 * Rb, 0, TAU); g.stroke();
      }
      if (ptr.act > .02) {
        g.strokeStyle = hsla(S.h2, 100, 75, .5 * ptr.act * S.br); g.lineWidth = Math.max(1, R * .01);
        g.beginPath(); g.arc(ptr.x * Rb, ptr.y * Rb, Rb * (holdOn ? .16 + .03 * Math.sin(t * 10) : .1), 0, TAU); g.stroke();
        glow(ptr.x * Rb, ptr.y * Rb, Rb * .25, S.h2, 70, (holdOn ? .5 : .3) * ptr.act * S.br);
      }
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

    /* ---------- gestos ---------- */
    function pointer(x, y, active) { ptr.tx = x; ptr.ty = y; ptr.actT = active ? 1 : 0; holdOn = !!active; if (active && ptr.act < .02) { ptr.x = x; ptr.y = y; } }
    function fromEvent(e) { const r = canvas.getBoundingClientRect(), R = Math.min(r.width, r.height) * opts.radius; return [(e.clientX - r.left - r.width / 2) / R, (e.clientY - r.top - r.height / 2) / R]; }
    const pts = new Map(); let moved = 0, downT = 0, holdTimer = 0, lastTap = 0, lastMoveT = 0, pinch0 = 0, zt0 = 1;
    const pdist = () => { const a = Array.from(pts.values()); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };

    function resetView() { resetting = .9; yawTarget = Math.round(view.yaw / TAU) * TAU; view.zt = 1; gesture('reset'); }
    function tap(e) {
      const p = fromEvent(e); waves.push({ x: p[0], y: p[1], t: 0 }); if (waves.length > 3) waves.shift();
      if (opts.popOnTap) S.pop = Math.max(S.pop, 1.2);
      haptic(12); if (e.timeStamp - lastTap < 320) resetView(); lastTap = e.timeStamp; gesture('tap');
    }
    function onDown(e) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      const p = fromEvent(e); ptr.tx = p[0]; ptr.ty = p[1]; ptr.x = p[0]; ptr.y = p[1]; ptr.actT = 1; mouseHover = false;
      if (pts.size === 1) {
        dragging = false; holdOn = false; moved = 0; downT = e.timeStamp; lastMoveT = e.timeStamp;
        holdTimer = setTimeout(() => { if (pts.size === 1 && !dragging && moved < 10) { holdOn = true; haptic(8); gesture('hold'); } }, 380);
      } else if (pts.size === 2) { clearTimeout(holdTimer); holdOn = false; dragging = false; pinch0 = pdist(); zt0 = view.zt; }
      if (opts.tilt && !tilt.on) enableTilt();
    }
    function onMove(e) {
      const pt = pts.get(e.pointerId);
      if (!pt) { if (e.pointerType === 'mouse') { const p = fromEvent(e); ptr.tx = p[0]; ptr.ty = p[1]; ptr.actT = 1; mouseHover = true; } return; }
      const dx = e.clientX - pt.x, dy = e.clientY - pt.y, dts = Math.max(.004, (e.timeStamp - pt.t) / 1000);
      pt.x = e.clientX; pt.y = e.clientY; pt.t = e.timeStamp; lastMoveT = e.timeStamp;
      const p = fromEvent(e); ptr.tx = p[0]; ptr.ty = p[1];
      if (pts.size === 2) { if (pinch0 > 0) { view.zt = clamp(zt0 * pdist() / pinch0, opts.zoomRange[0], opts.zoomRange[1]); gesture('pinch'); } return; }
      moved += Math.abs(dx) + Math.abs(dy);
      if (holdOn) return;
      if (moved > 8 || dragging) {
        if (!dragging) gesture('drag');
        dragging = true; clearTimeout(holdTimer);
        const r = canvas.getBoundingClientRect(), Rc = Math.min(r.width, r.height) * opts.radius, dyaw = dx / Rc * 2.6, dp = dy / Rc * 2;
        view.yaw += dyaw; view.pitch = clamp(view.pitch - dp, -1.2, 1.2);   // el frente sigue al dedo: deslizar hacia abajo lo baja
        view.vyaw = clamp(lerp(view.vyaw, dyaw / dts, .4), -9, 9); view.vpitch = clamp(lerp(view.vpitch, -dp / dts, .4), -6, 6);
      }
    }
    function onUp(e) {
      pts.delete(e.pointerId); clearTimeout(holdTimer);
      if (pts.size === 0) {
        if (!dragging && !holdOn && moved < 10 && e.timeStamp - downT < 320) tap(e);
        if (e.timeStamp - lastMoveT > 90) { view.vyaw = 0; view.vpitch = 0; }
        dragging = false; holdOn = false; ptr.actT = 0;
      } else { pinch0 = 0; moved = 99; dragging = false; }
    }
    const onLeave = () => { if (pts.size === 0) { ptr.actT = 0; mouseHover = false; } };
    const onWheel = e => { e.preventDefault(); view.zt = clamp(view.zt * Math.exp(-e.deltaY * .0012), opts.zoomRange[0], opts.zoomRange[1]); };
    const onTilt = e => {
      if (e.gamma == null) return;
      tilt.yT = clamp(e.gamma / 45, -1, 1) * .35; tilt.pT = clamp(((e.beta || 0) - 55) / 45, -1, 1) * .25;
    };
    function enableTilt() {
      if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return Promise.resolve(false);
      const go = () => { window.addEventListener('deviceorientation', onTilt); tilt.on = true; return true; };
      if (typeof DeviceOrientationEvent.requestPermission === 'function')
        return DeviceOrientationEvent.requestPermission().then(r => (r === 'granted' ? go() : false)).catch(() => false);
      return Promise.resolve(go());
    }

    if (opts.bind && canvas.addEventListener) {
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('pointerleave', onLeave);
      canvas.addEventListener('wheel', onWheel, { passive: false });
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
      shock(x, y) { waves.push({ x: x || 0, y: y || 0, t: 0 }); if (waves.length > 3) waves.shift(); },
      setView(v) { if (v.yaw != null) view.yaw = v.yaw; if (v.pitch != null) view.pitch = clamp(v.pitch, -1.2, 1.2); if (v.zoom != null) view.zt = clamp(v.zoom, opts.zoomRange[0], opts.zoomRange[1]); },
      resetView, enableTilt, pointer, resize,
      start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(loop); } },
      stop() { running = false; cancelAnimationFrame(raf); },
      destroy() {
        api.stop(); if (ro) ro.disconnect(); if (io) io.disconnect(); clearTimeout(holdTimer);
        if (typeof window !== 'undefined') window.removeEventListener('deviceorientation', onTilt);
        if (opts.bind && canvas.removeEventListener) {
          canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
          canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
          canvas.removeEventListener('pointerleave', onLeave); canvas.removeEventListener('wheel', onWheel);
        }
      },
      frame(dt) { step(dt == null ? 1 / 60 : dt); render(); },      // avance manual (útil para pruebas o capturas)
      get view() { return { yaw: view.yaw, pitch: view.pitch, zoom: view.zoom }; },
      get particles() { return N; }
    };
    if (opts.autoStart) api.start();
    return api;
  }

  return { create, STATES, SHAPES, version: '1.1' };
});
