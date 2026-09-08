'use strict';

/* ravive — utilitaires partagés par les parcours (contributeur, organisateur, destinataire) */

window.RV = (function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(s) {
    s = Math.max(0, Math.round(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function bars(n, seed) {
    var h = [8, 15, 22, 12, 25, 17, 10, 23, 14, 19, 8, 17, 24, 12, 20, 10, 16, 22, 14, 9, 20, 12];
    var out = '';
    for (var i = 0; i < (n || h.length); i++) out += '<i style="height:' + h[(i + (seed || 0)) % h.length] + 'px"></i>';
    return out;
  }
  function fmtDate(iso, opts) {
    if (!iso) return '—';
    return new Date(iso + 'T00:00').toLocaleDateString('fr-FR', opts || { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function fmtShort(iso) { return fmtDate(iso, { day: 'numeric', month: 'long' }); }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function addDays(iso, d) { var t = new Date(iso + 'T00:00'); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 86400000); }

  // Accord des pronoms selon le genre du destinataire
  function pron(g) {
    return g === 'm'
      ? { El: 'Il', el: 'il', lui: 'lui', la: 'le', sa: 'son', fete: 'le fêté' }
      : { El: 'Elle', el: 'elle', lui: 'elle', la: 'la', sa: 'sa', fete: 'la fêtée' };
  }

  // Appels API : JSON par défaut, corps brut (Blob) pour les médias
  function api(method, url, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    var body = opts.body;
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (body && !(body instanceof Blob)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    return fetch(url, { method: method, headers: headers, body: body }).then(function (r) {
      return r.text().then(function (t) {
        var j = {};
        try { j = t ? JSON.parse(t) : {}; } catch (e) { j = {}; }
        if (!r.ok) { var e = new Error(j.error || 'http_' + r.status); e.status = r.status; e.body = j; throw e; }
        return j;
      });
    });
  }

  // Lecture d'un fichier image → Image chargée (orientation gérée par le navigateur moderne)
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }

  // Réduction côté client avant envoi (max 2000 px) → Blob JPEG + facteur d'échelle
  function shrink(img, max) {
    max = max || 2000;
    var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    var cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * scale);
    cv.height = Math.round(img.naturalHeight * scale);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return new Promise(function (resolve) {
      cv.toBlob(function (b) { resolve({ blob: b, scale: scale, width: cv.width, height: cv.height }); }, 'image/jpeg', 0.86);
    });
  }

  /* Recadrage carré tactile : la photo se déplace et se zoome dans un carré.
     Retourne un objet { el, getCrop() } où getCrop est en pixels de l'image réduite. */
  function cropper(container, img, shrunk) {
    var size = container.clientWidth || 300;
    var W = shrunk.width, H = shrunk.height;
    var minScale = size / Math.min(W, H);
    var s = minScale, x = 0, y = 0; // position du coin haut-gauche de l'image dans le carré
    var el = document.createElement('img');
    el.src = img.src;
    el.draggable = false;
    container.appendChild(el);
    var hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Déplace la photo pour choisir le cadrage';
    container.appendChild(hint);
    function center() { x = (size - W * s) / 2; y = (size - H * s) / 2; }
    function clamp() {
      x = Math.min(0, Math.max(size - W * s, x));
      y = Math.min(0, Math.max(size - H * s, y));
    }
    function draw() { el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')'; }
    center(); draw();
    var last = null, pinch = null;
    container.addEventListener('pointerdown', function (e) { last = { x: e.clientX, y: e.clientY, id: e.pointerId }; container.setPointerCapture(e.pointerId); });
    container.addEventListener('pointermove', function (e) {
      if (!last || last.id !== e.pointerId) return;
      x += e.clientX - last.x; y += e.clientY - last.y; last.x = e.clientX; last.y = e.clientY; clamp(); draw();
    });
    container.addEventListener('pointerup', function () { last = null; });
    container.addEventListener('pointercancel', function () { last = null; });
    container.addEventListener('touchstart', function (e) { if (e.touches.length === 2) { pinch = { d: dist(e.touches), s: s }; } }, { passive: true });
    container.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && pinch) { setScale(pinch.s * (dist(e.touches) / pinch.d)); }
    }, { passive: true });
    container.addEventListener('touchend', function () { pinch = null; });
    function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    function setScale(ns) {
      ns = Math.max(minScale, Math.min(minScale * 4, ns));
      var cx = size / 2, cy = size / 2;
      x = cx - (cx - x) * (ns / s); y = cy - (cy - y) * (ns / s); s = ns; clamp(); draw();
    }
    return {
      setZoom: function (v) { setScale(minScale * v); },
      getCrop: function () {
        var side = Math.round(size / s);
        return { x: Math.round(-x / s), y: Math.round(-y / s), w: side, h: side };
      },
    };
  }

  /* Enregistreur vocal : MediaRecorder, minuterie, arrêt automatique */
  function recorder(opts) {
    var stream = null, rec = null, chunks = [], startedAt = 0, timer = null;
    function pickMime() {
      var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      for (var i = 0; i < c.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c[i])) return c[i];
      return '';
    }
    return {
      supported: !!(navigator.mediaDevices && window.MediaRecorder),
      start: function () {
        return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) {
          stream = st;
          var mime = pickMime();
          rec = mime ? new MediaRecorder(st, { mimeType: mime }) : new MediaRecorder(st);
          chunks = [];
          rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
          rec.start(250);
          startedAt = Date.now();
          timer = setInterval(function () {
            var s = (Date.now() - startedAt) / 1000;
            if (opts.onTick) opts.onTick(s);
            if (s >= opts.maxSeconds) this.stop();
          }.bind(this), 250);
        }.bind(this));
      },
      stop: function () {
        var self = this;
        return new Promise(function (resolve) {
          if (!rec || rec.state === 'inactive') return resolve(null);
          var duration = Math.min((Date.now() - startedAt) / 1000, opts.maxSeconds);
          rec.onstop = function () {
            var mime = (rec.mimeType || 'audio/webm').split(';')[0];
            var blob = new Blob(chunks, { type: mime });
            self.cleanup();
            resolve(duration >= 1 && blob.size > 1000 ? { blob: blob, mime: mime, duration: duration } : null);
          };
          rec.stop();
        });
      },
      cleanup: function () {
        if (timer) clearInterval(timer);
        timer = null;
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
      },
      recording: function () { return !!rec && rec.state === 'recording'; },
    };
  }

  // Lecteur audio minimal réutilisable
  function player(url) {
    var a = new Audio(url);
    a.preload = 'metadata';
    return a;
  }

  return { esc: esc, fmt: fmt, bars: bars, fmtDate: fmtDate, fmtShort: fmtShort, todayISO: todayISO, addDays: addDays, daysBetween: daysBetween, pron: pron, api: api, loadImage: loadImage, shrink: shrink, cropper: cropper, recorder: recorder, player: player };
})();
