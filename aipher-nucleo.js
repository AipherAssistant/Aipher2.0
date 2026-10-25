/*! Aipher · núcleo 5.1.6. Funciones puras, sin dependencias ni acceso al DOM.
    Se cargan antes de app.js y se prueban en Node con tests/unitarias.cjs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AipherNucleo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Escapa texto para insertarlo en HTML. */
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Decodifica entidades HTML en UNA sola pasada (evita decodificar dos veces). */
  const NOMBRADAS = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const dec = t => String(t == null ? '' : t).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
    }
    const v = NOMBRADAS[e.toLowerCase()];
    return v === undefined ? m : v;
  });

  /* Título de un chat: primera línea, máximo 60 caracteres, corte en palabra. */
  function titulo(t) {
    const l = String(t || '').trim().split('\n')[0].replace(/\s+/g, ' ');
    if (l.length <= 60) return l || 'Chat';
    const c = l.slice(0, 60), sp = c.lastIndexOf(' ');
    return (sp > 30 ? c.slice(0, sp) : c) + '…';
  }

  /* Quita encabezados que el modelo puede devolver al resumir (texto del propio prompt). */
  function limpiarResumen(t) {
    let s = String(t || '').trim(), prev;
    do {
      prev = s;
      s = s.replace(/^\s*(\*\*|#+\s*)?\s*resumen del mensaje de aipher\s*(\*\*)?\s*[:.\-–—]?\s*/i, '');
    } while (s !== prev);
    return s.trim();
  }

  /* Cola serializada por clave: las tareas de una misma clave se ejecutan una tras otra. */
  function colaPorClave() {
    const colas = new Map();
    return function (clave, tarea) {
      const prev = colas.get(clave) || Promise.resolve();
      const p = prev.catch(() => {}).then(tarea);
      colas.set(clave, p);
      const limpiar = () => { if (colas.get(clave) === p) colas.delete(clave); };
      p.then(limpiar, limpiar);
      return p;
    };
  }

  /* Últimos caracteres de una respuesta cortada, para que la continuación retome justo ahí. */
  function colaDe(texto) {
    const t = String(texto || '').replace(/\s+$/, '');
    if (!t) return '';
    return t.length > 240 ? '…' + t.slice(-240) : t;
  }

  /* Ajusta el cuerpo de la petición para Groq (gpt-oss) o para el modo local.
     - max_tokens (obsoleto) pasa a max_completion_tokens, que incluye el razonamiento.
     - reasoning_format 'hidden' es el valor que Groq admite con herramientas. */
  function prepararCuerpoGroq(body, opts) {
    const b = Object.assign({}, body);
    b.model = (opts && opts.modelo) || 'openai/gpt-oss-120b';
    if (b.max_tokens != null) { b.max_completion_tokens = b.max_tokens; delete b.max_tokens; }
    if (/gpt-oss/i.test(b.model)) {
      b.reasoning_effort = b.reasoning_effort || (opts && opts.razonamiento) || 'medium';
      b.reasoning_format = 'hidden';
    } else {
      delete b.reasoning_effort;
      delete b.reasoning_format;
    }
    return b;
  }

  /* Cuerpo para el modo local (llama-server): sin campos de Groq. */
  function prepararCuerpoLocal(body) {
    const b = Object.assign({}, body);
    delete b.reasoning_effort;
    delete b.reasoning_format;
    delete b.max_completion_tokens;
    return b;
  }

  return { esc, dec, titulo, limpiarResumen, colaPorClave, colaDe, prepararCuerpoGroq, prepararCuerpoLocal };
});
