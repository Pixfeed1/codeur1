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
    // Cadre carré par défaut ; portrait si le conteneur a sa propre hauteur (photo d'un souvenir)
    var BW = container.clientWidth || 300;
    var BH = container.clientHeight && Math.abs(container.clientHeight - BW) > 2 ? container.clientHeight : BW;
    var W = shrunk.width, H = shrunk.height;
    var minScale = Math.max(BW / W, BH / H);
    var s = minScale, x = 0, y = 0; // position du coin haut-gauche de l'image dans le cadre
    var el = document.createElement('img');
    el.src = img.src;
    el.draggable = false;
    el.style.width = W + 'px';   // même géométrie que l'image envoyée au serveur,
    el.style.height = H + 'px';  // quelle que soit la taille de l'originale
    container.appendChild(el);
    var hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Déplace la photo pour choisir le cadrage';
    container.appendChild(hint);
    function center() { x = (BW - W * s) / 2; y = (BH - H * s) / 2; }
    function clamp() {
      x = Math.min(0, Math.max(BW - W * s, x));
      y = Math.min(0, Math.max(BH - H * s, y));
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
      var cx = BW / 2, cy = BH / 2;
      x = cx - (cx - x) * (ns / s); y = cy - (cy - y) * (ns / s); s = ns; clamp(); draw();
    }
    return {
      setZoom: function (v) { setScale(minScale * v); },
      getCrop: function () {
        return { x: Math.round(-x / s), y: Math.round(-y / s), w: Math.round(BW / s), h: Math.round(BH / s) };
      },
    };
  }

  function recorder(opts) {
    var stream = null, rec = null, chunks = [], startedAt = 0, timer = null, stopping = null;
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
          chunks = []; stopping = null;
          rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
          rec.start(250);
          startedAt = Date.now();
          timer = setInterval(function () {
            var s = (Date.now() - startedAt) / 1000;
            if (opts.onTick) opts.onTick(s);
            if (s >= opts.maxSeconds) this.stop().then(function (r) { if (opts.onAutoStop) opts.onAutoStop(r); });
          }.bind(this), 250);
        }.bind(this));
      },
      stop: function () {
        var self = this;
        if (stopping) return stopping; // déjà arrêté (par exemple à la durée max) : même résultat
        stopping = new Promise(function (resolve) {
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
        return stopping;
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

  /* Lecteur unique pour les stories : iOS n'autorise play() que dans une interaction,
     mais un élément déjà lancé une fois peut ensuite rejouer sans geste (enchaînement automatique). */
  var SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  function audioPlayer() {
    var el = new Audio();
    el.preload = 'auto';
    var unlocked = false, ctx = null, analyser = null, buf = null;
    // Analyse du niveau sonore (Web Audio) pour le halo : créée dans un geste de
    // l'utilisateur (iOS), et seulement si le contexte tourne vraiment ; sinon on
    // laisse l'élément audio jouer normalement et le halo suit une enveloppe synthétique.
    function setupAnalyser() {
      if (analyser !== null) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { analyser = false; return; }
      try {
        ctx = new AC();
        var pr = ctx.resume();
        (pr && pr.then ? pr : Promise.resolve()).then(function () {
          if (ctx.state !== 'running' || analyser !== null) { if (analyser === null) analyser = false; return; }
          try {
            var src = ctx.createMediaElementSource(el);
            analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.6;
            src.connect(analyser);
            analyser.connect(ctx.destination);
            buf = new Uint8Array(analyser.fftSize);
          } catch (e) { analyser = false; }
        }).catch(function () { analyser = false; });
      } catch (e) { analyser = false; }
    }
    function unlock() {
      if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* rien */ } }
      if (unlocked) return;
      unlocked = true;
      setupAnalyser();
      try {
        el.src = SILENT;
        var pr = el.play();
        // ne mettre en pause que si rien de réel n'a été lancé entre-temps
        if (pr && pr.catch) pr.then(function () { if (el.src === SILENT) el.pause(); }).catch(function () { unlocked = false; });
      } catch (e) { unlocked = false; }
    }
    document.addEventListener('touchend', unlock, { capture: true, passive: true });
    document.addEventListener('click', unlock, { capture: true });
    return {
      el: el,
      play: function (url, h) {
        h = h || {};
        el.onended = h.onended || null;
        el.ontimeupdate = h.ontimeupdate || null;
        el.onpause = null;
        if (el.src !== url) { el.src = url; el.load(); }
        if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* rien */ } }
        var pr = el.play();
        return pr && pr.catch ? pr : Promise.resolve();
      },
      pause: function () { try { el.pause(); } catch (e) { /* rien */ } },
      stop: function () { try { el.pause(); el.onended = null; el.ontimeupdate = null; el.removeAttribute('src'); el.load(); } catch (e) { /* rien */ } },
      playing: function () { return !el.paused && !el.ended && el.src && el.src !== SILENT; },
      // Niveau sonore instantané (0-1), ou null si l'analyse n'est pas disponible
      level: function () {
        if (!analyser || ctx.state !== 'running') return null;
        analyser.getByteTimeDomainData(buf);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
        return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
      },
    };
  }

  /* ===================== V1.1 : icônes Ravive, univers, stories ===================== */

  // Icônes « signature » en trait fin (maquettes finales) : micro, crayon, appareil photo
  function ravIcon(kind, main, cut) {
    var shine = 'rgba(255,255,255,.5)';
    function Rl(x, y, sz, c) { return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-family="Caveat,cursive" font-weight="700" font-style="italic" font-size="' + sz + '" fill="' + c + '">R</text>'; }
    if (kind === 'mic') return '<svg viewBox="0 0 48 48" fill="none"><rect x="16.5" y="6" width="15" height="23" rx="7.5" fill="' + main + '"/><path d="M20.6 9.6Q18.8 14 20.4 18.6" stroke="' + shine + '" stroke-width="1.8" stroke-linecap="round"/>' + Rl(24, 23, 15, cut) + '<path d="M11.5 22a12.5 12.5 0 0 0 25 0" stroke="' + main + '" stroke-width="3" stroke-linecap="round"/><path d="M24 34.5v6.6" stroke="' + main + '" stroke-width="3" stroke-linecap="round"/><path d="M16.5 41.3h15" stroke="' + main + '" stroke-width="3" stroke-linecap="round"/></svg>';
    if (kind === 'pen') return '<svg viewBox="0 0 48 48" fill="none"><rect x="8" y="9" width="20" height="30" rx="3.4" fill="' + main + '"/><path d="M12 16.8h11M12 21.4h11M12 26h7" stroke="' + cut + '" stroke-width="2.4" stroke-linecap="round"/>' + Rl(15.5, 35.5, 12, cut) + '<path d="M36 19 L22 37" stroke="' + main + '" stroke-width="8.5" stroke-linecap="round"/><path d="M35.2 19.8 L22.6 36.2" stroke="' + cut + '" stroke-width="4.6" stroke-linecap="round"/><path d="M22.8 35.8 L21.4 38.4" stroke="' + main + '" stroke-width="4.6" stroke-linecap="round"/></svg>';
    return '<svg viewBox="0 0 48 48" fill="none"><path d="M14 15l1.8-3.3h7.4L25 15Z" fill="' + main + '"/><rect x="6" y="15" width="33" height="23" rx="4.6" fill="' + main + '"/><rect x="9.5" y="18.4" width="5.4" height="2.8" rx="1.4" fill="' + cut + '"/><circle cx="21" cy="27.2" r="8.6" fill="' + cut + '"/><circle cx="21" cy="27.2" r="5.5" fill="' + main + '"/><path d="M17.6 24.4a4.7 4.7 0 0 1 3.2-1.9" stroke="' + shine + '" stroke-width="1.6" stroke-linecap="round"/>' + Rl(33, 31.5, 13, cut) + '</svg>';
  }
  var ICONS = {
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3.4" height="14" rx="1.3"/><rect x="13.6" y="5" width="3.4" height="14" rx="1.3"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
    spk: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"/><path d="M15.5 8.5a4 4 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20l-1.4-1.3C6 14.4 3.5 12 3.5 9 3.5 6.5 5.4 4.6 7.8 4.6c1.4 0 2.7.7 3.5 1.8.8-1.1 2.1-1.8 3.5-1.8 2.4 0 4.3 1.9 4.3 4.4 0 3-2.5 5.4-7.1 9.7L12 20Z"/></svg>',
    heartFull: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.7l-1.4-1.3C6 15.4 3.5 13 3.5 9.9 3.5 7.5 5.4 5.6 7.8 5.6c1.4 0 2.7.6 3.5 1.7.8-1.1 2.1-1.7 3.5-1.7 2.4 0 4.3 1.9 4.3 4.3 0 3.1-2.5 5.5-7.1 9.5L12 20.7Z"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    refresh: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M38 24a14 14 0 1 1-4.2-10"/><path d="M38 8v8h-8"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.8c.45 5 1.7 6.25 6.7 6.7-5 .45-6.25 1.7-6.7 6.7-.45-5-1.7-6.25-6.7-6.7 5-.45 6.25-1.7 6.7-6.7Z"/></svg>',
  };

  // Un univers par thème de question (clé = catégorie ; free = mot libre).
  // wash/soft/vivid : écran de réponse du contributeur ; bg/acc/ink : story.
  var UNIVERSES = {
    dire:    { wash: '#F8E6E0', soft: '#F1D6CE', vivid: '#BF5D4D', bg: '#BF5D4D', acc: '#E8B39A', ink: '#35251D' },
    souv:    { wash: '#E8ECE2', soft: '#D6DECB', vivid: '#52694C', bg: '#52694C', acc: '#A9BE8B', ink: '#30261F' },
    dossier: { wash: '#F8EED5', soft: '#F0DFB8', vivid: '#C89546', bg: '#DDA64B', acc: '#B98236', ink: '#35251D' },
    nous:    { wash: '#E6EEF4', soft: '#D4E1EC', vivid: '#6694BC', bg: '#6694BC', acc: '#A9CBE2', ink: '#30261F' },
    devant:  { wash: '#E0EBE9', soft: '#C8DAD7', vivid: '#397C7A', bg: '#397C7A', acc: '#D8D4C2', ink: '#F5E8D3' },
    free:    { wash: '#F4E7DC', soft: '#ECD9C8', vivid: '#C77B5A', bg: '#BF5D4D', acc: '#E8B39A', ink: '#35251D' },
  };
  function universe(key) { return UNIVERSES[key] || UNIVERSES.free; }
  function universeVars(u) { return '--wash:' + u.wash + ';--soft:' + u.soft + ';--vivid:' + u.vivid + ';background:var(--wash)'; }
  function rgba(hex, a) { var h = hex.replace('#', ''); return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' + parseInt(h.substr(4, 2), 16) + ',' + a + ')'; }

  /* Rendu d'une story (contributeur en aperçu et destinataire) selon son contenu :
     vocal seul (halo), texte seul, photo + vocal, photo + texte, photo seule (ancien format).
     item : { hasAudio, hasText, hasPhoto, text, duration, photoFull, photoFocus, questionPos, overlayDark, category, free, question }
     opts : { kickVoice, kickText, kickPhoto, playing (bouton pause/lecture), fmt } */
  function storyView(item, opts) {
    opts = opts || {};
    var u = universe(item.free ? 'free' : item.category);
    var hasA = !!item.hasAudio, hasT = !!item.hasText, hasP = !!item.hasPhoto;
    var foc = item.photoFocus == null ? 50 : item.photoFocus;
    var pos = item.questionPos === 'bottom' ? 'bottom' : 'top';
    var q = esc(item.question || '');
    var foot = '<div class="mfoot">Des souvenirs qui restent</div><div class="mheartf">' + ICONS.heart + '</div>';
    var photoBg = 'background-image:url(\'' + (item.photoFull || item.photo) + '\');background-position:50% ' + foc + '%';
    var durTxt = fmt(item.duration || 0);
    var cls, style, mid, halo = false;
    if (hasA && hasP) {
      halo = true; cls = 'st-vp' + (item.overlayDark ? ' odark' : ''); style = photoBg;
      mid = '<div class="mveil-top"></div><div class="mveil-bot"></div>' +
        '<div class="mphoto-q ' + pos + '"><div class="makick">' + esc(opts.kickVoice || 'Un souvenir pour toi') + '</div><div class="maq2">' + q + '</div></div>' +
        '<div class="vpbar2"><button class="vp-mini" id="mpauseBtn">' + ICONS.pause + '</button><span id="mct">0:00</span><span class="track"><i id="mtrack"></i></span><span>' + durTxt + '</span></div>' + foot;
    } else if (hasT && hasP) {
      cls = 'st-tp' + (item.overlayDark ? ' odark' : ''); style = photoBg;
      mid = '<div class="mveil-top"></div>' +
        '<div class="mphoto-q ' + pos + '"><div class="makick">' + esc(opts.kickText || 'Un mot pour toi') + '</div><div class="maq2">' + q + '</div></div>' +
        '<button class="tp-open" id="tpopen">' + ICONS.doc + '<span>Lire son message</span><span class="tparr">↑</span></button>' +
        '<div class="tp-panel" id="tppanel"><span class="tp-q">“</span><div class="tp-text">« ' + esc(item.text) + ' »</div><div class="tp-heart">' + ICONS.heart + '</div><button class="btn tp-close" id="tpclose">Fermer</button></div>' +
        '<div class="mfoot" style="color:#fff">Des souvenirs qui restent</div>';
    } else if (hasA) {
      halo = true; cls = 'st-audio'; style = 'background:' + u.bg + ';color:' + u.ink;
      mid = '<div class="makick">' + esc(opts.kickVoice || 'Un mot pour toi') + '</div><div class="maq">' + q + '</div>' +
        '<div class="halowrap"><div class="haloamb" id="haloAmb" style="background:radial-gradient(circle,' + rgba(u.acc, .5) + ',transparent 62%)"></div>' +
        '<svg class="halo2" viewBox="0 0 200 200" style="filter:drop-shadow(0 0 6px ' + rgba(u.acc, .55) + ')"><defs><radialGradient id="coreG" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="' + u.acc + '" stop-opacity="0.55"/><stop offset="72%" stop-color="' + u.acc + '" stop-opacity="0"/></radialGradient></defs>' +
        '<circle id="haloCore" cx="100" cy="100" r="46" fill="url(#coreG)"></circle><g id="haloRays" stroke="' + u.acc + '" stroke-linecap="round"></g></svg></div>' +
        '<button class="mpause" id="mpauseBtn">' + ICONS.pause + '</button>' +
        '<div class="mbar"><span class="ic">' + ICONS.spk + '</span><span id="mct">0:00</span><span class="track"><i id="mtrack"></i></span><span>' + durTxt + '</span><span class="dots">•••</span></div>' + foot;
    } else if (hasP) {
      cls = 'st-photo'; style = photoBg;
      mid = '<div class="mveil-top"></div><div class="mveil-bot"></div>' +
        '<div class="mphoto-q ' + pos + '"><div class="makick">' + esc(opts.kickPhoto || 'Ton souvenir en image') + '</div><div class="maq2">' + q + '</div></div>' + foot;
    } else {
      cls = 'st-text'; style = 'background:' + u.bg + ';color:' + u.ink;
      var len = (item.text || '').trim().length, size = len < 14 ? 52 : len < 40 ? 40 : len < 110 ? 27 : len < 220 ? 23 : len < 340 ? 20 : len < 480 ? 18 : len < 650 ? 16 : 15;
      mid = '<div class="mblobs"><span style="background:' + rgba(u.acc, .14) + '"></span><span style="background:' + rgba(u.acc, .10) + '"></span></div>' +
        '<div class="makick">' + esc(opts.kickText || 'Un mot pour toi') + '</div><div class="maq">' + q + '</div>' +
        '<div class="mtextwrap' + (len > 300 ? ' longtxt' : '') + '"><span class="mq1" style="color:' + u.acc + '">“</span><div class="mtextbody" style="font-size:' + size + 'px">' + esc(item.text) + '</div><span class="mq2" style="color:' + u.acc + '">”</span>' +
        (opts.signature ? '<div class="msig">— ' + esc(opts.signature) + '</div>' : '') + '<div class="mtheart">' + ICONS.heart + '</div></div>' +
        '<div class="mfoot">Des souvenirs qui restent</div>';
    }
    return { cls: cls, style: style, html: '<div class="mbg" style="' + style + '"></div>' + mid, halo: halo, universe: u };
  }
  // Panneau « Lire son message » (photo + texte)
  function bindTextPanel() {
    var pn = document.getElementById('tppanel'), op = document.getElementById('tpopen'), cl = document.getElementById('tpclose');
    if (!pn || !op) return;
    var toggle = function (e) { if (e) e.stopPropagation(); var open = pn.classList.toggle('open'); op.style.opacity = open ? '0' : '1'; };
    op.onclick = toggle; if (cl) cl.onclick = toggle;
  }

  /* Halo « soleil » qui suit la voix : 60 rayons autour d'un cœur lumineux.
     level() renvoie le niveau sonore réel (0-1) ou null (enveloppe synthétique de secours).
     Retourne stop(). */
  function halo(getLevel, getTime, getDur, isPaused) {
    var raysG = document.getElementById('haloRays');
    var core = document.getElementById('haloCore'), amb = document.getElementById('haloAmb'), timeEl = document.getElementById('mct'), track = document.getElementById('mtrack');
    var cx = 100, cy = 100, ringR = 54, M = 60, rays = [], rlen = [], rph = [], rfr = [];
    if (raysG) {
      raysG.innerHTML = '';
      for (var i = 0; i < M; i++) {
        var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        ln.setAttribute('stroke-width', (1.4 + Math.random() * 1.1).toFixed(2));
        raysG.appendChild(ln); rays.push(ln); rlen.push(6 + Math.random() * 16); rph.push(Math.random() * 6.283); rfr.push(0.8 + Math.random() * 1.1);
      }
    }
    var t0 = performance.now(), cur = 0.08, raf = null, alive = true;
    function env(x) {
      var speech = Math.abs(Math.sin(x * 3.0)) * 0.45 + Math.abs(Math.sin(x * 5.3 + 1.1)) * 0.30 + Math.abs(Math.sin(x * 8.1 + 0.5)) * 0.18;
      var g = Math.sin(x * 0.8) + Math.sin(x * 0.33 + 2.1); g = g > -0.4 ? 1 : 0.12;
      return Math.max(0.04, Math.min(1, 0.12 + 0.05 * Math.sin(x * 1.5) + speech * g * 0.74));
    }
    function frame(now) {
      if (!alive) return;
      var t = (now - t0) / 1000, ct = getTime() || 0, dur = getDur() || 1;
      var target;
      if (isPaused()) target = 0.05;
      else { var lv = getLevel(); target = lv == null ? env(ct) : Math.max(0.04, Math.min(1, 0.1 + lv * 1.1)); }
      cur += (target - cur) * (target > cur ? 0.35 : 0.14);
      var a = cur;
      for (var i = 0; i < rays.length; i++) {
        var ang = (i / M) * 6.283, osc = Math.sin(t * 2.2 * rfr[i] + rph[i]) * 0.5 + 0.5;
        var len = rlen[i] * 0.5 + 2 + a * 30 + osc * (3 + a * 8);
        var l = rays[i];
        l.setAttribute('x1', (cx + Math.cos(ang) * ringR).toFixed(1)); l.setAttribute('y1', (cy + Math.sin(ang) * ringR).toFixed(1));
        l.setAttribute('x2', (cx + Math.cos(ang) * (ringR + len)).toFixed(1)); l.setAttribute('y2', (cy + Math.sin(ang) * (ringR + len)).toFixed(1));
        l.setAttribute('stroke-opacity', (0.22 + a * 0.62 * (0.45 + osc * 0.55)).toFixed(3));
      }
      if (core) { core.style.transform = 'scale(' + (0.7 + a * 0.9).toFixed(3) + ')'; core.style.opacity = (0.35 + a * 0.5).toFixed(3); }
      if (amb) { amb.style.opacity = (0.22 + a * 0.5).toFixed(3); amb.style.transform = 'scale(' + (0.85 + a * 0.35).toFixed(3) + ')'; }
      if (timeEl) timeEl.textContent = fmt(Math.ceil(ct));
      if (track) track.style.width = Math.max(4, Math.min(100, (ct / dur) * 100)).toFixed(0) + '%';
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return function () { alive = false; if (raf) cancelAnimationFrame(raf); };
  }

  // Ouverture signature (V1.1) : cœur, nom Ravive, trait, sous-titre ; puis callback
  function opening(container, sub, done, ms) {
    container.innerHTML = '<div class="ravsig"><div class="glow"></div><div class="hp">' + ICONS.heartFull + '</div><div class="n">Ravive</div><div class="line"></div><div class="s">' + esc(sub) + '</div></div>';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return setTimeout(done, reduce ? 300 : (ms || 2300));
  }

  return { esc: esc, fmt: fmt, bars: bars, fmtDate: fmtDate, fmtShort: fmtShort, todayISO: todayISO, addDays: addDays, daysBetween: daysBetween, pron: pron, api: api, loadImage: loadImage, shrink: shrink, cropper: cropper, recorder: recorder, player: player, audioPlayer: audioPlayer,
    ravIcon: ravIcon, icons: ICONS, universe: universe, universeVars: universeVars, rgba: rgba, storyView: storyView, bindTextPanel: bindTextPanel, halo: halo, opening: opening };
})();
