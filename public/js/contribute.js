'use strict';

/* ravive — parcours contributeur (maquette v5), branché sur l'API /api/p/:slug */

(function () {
  var R = window.RV;
  var ST = window.RAVIVE_STATE || {};
  var app = document.getElementById('app');
  var fp = document.getElementById('fp');   // photo du cadre
  var fps = document.getElementById('fps'); // selfie
  var fpq = document.getElementById('fpq'); // photo-réponse
  var P = ST.recipientName || 'elle';
  var FROM = ST.organizerName || 'Quelqu’un';
  var G = ST.recipientGender || 'f';
  var pr = R.pron(G);
  var MAXQ = ST.maxMemories || 4;
  var MAX_S = ST.maxAudioS || 60;
  var MAX_TXT = ST.maxTextChars || 1000;
  var CATS = {};
  (ST.categories || []).forEach(function (c) { CATS[c.key] = c; });
  var apiBase = '/api/p/' + ST.slug;
  var storeKey = 'ravive_p_' + ST.slug;

  var S;
  function reset() {
    S = {
      sc: 'invite', id: null, token: null, name: '', rel: null,
      selfie: null,            // { url } aperçu local
      photo: null,             // { url, photoId } photo du cadre
      free: null,              // { mode, text, audio(blob|null), duration, memoryId, playing }
      queue: [], qptr: 0, cur: null,
      answered: [],            // souvenirs enregistrés : { memoryId, q, ic, t, mode, text, duration, photoUrl, audioUrl }
      q: { mode: 'choice', text: '', audio: null, duration: 0, photo: null },
      editing: null, starId: null, mpi: 0, busy: false,
    };
  }
  reset();

  /* ------------------------------------------------------------- outils */
  function api(method, path, opts) {
    opts = opts || {};
    opts.token = S.token;
    return R.api(method, apiBase + path, opts);
  }
  function save() {
    try { sessionStorage.setItem(storeKey, JSON.stringify({ id: S.id, token: S.token, name: S.name })); } catch (e) { /* rien */ }
  }
  function render() { try { SC[S.sc](); } catch (e) { console.error(e); } window.scrollTo(0, 0); }
  function go(x) { S.sc = x; render(); }
  function busy(on, label) {
    S.busy = on;
    var b = app.querySelector('[data-busy]');
    if (b) { b.disabled = on; if (label) b.textContent = on ? label : b.dataset.busy; }
  }
  function fail(err) {
    var msg = 'Une erreur est survenue. Vérifie ta connexion et réessaie.';
    if (err && err.message === 'project_full') msg = 'Toutes les places sont prises, désolé !';
    if (err && err.message === 'closed') msg = 'La collecte est terminée.';
    if (err && err.message === 'unsupported_format') msg = 'Format de fichier non pris en charge.';
    if (err && err.message === 'unreadable_image') msg = 'Cette image ne peut pas être lue. Essaie une autre photo.';
    if (err && err.message === 'text_too_long') msg = 'Ton texte est trop long (' + MAX_TXT + ' caractères max).';
    var box = app.querySelector('.error');
    if (box) { box.textContent = msg; box.classList.add('show'); } else alert(msg);
    busy(false);
  }
  var SC = {};

  /* ---------------------------------------------------- écrans d'état */
  function centered(em, title, sub, buttons) {
    return '<div class="view center fade"><div style="font-size:42px">' + em + '</div>' +
      '<h1 class="lede" style="margin-top:12px">' + title + '</h1>' +
      (sub ? '<div class="sub" style="margin-top:12px">' + sub + '</div>' : '') +
      (buttons ? '<div class="stack" style="margin-top:22px;width:100%">' + buttons + '</div>' : '') + '</div>';
  }
  if (ST.notFound) { app.innerHTML = centered('🤔', 'Ce lien ne mène nulle part.', 'Vérifie l’adresse envoyée par la personne qui organise la surprise.'); return; }

  /* ---------------------------------------------------------- 1. accueil */
  SC.invite = function () {
    if (!ST.open) {
      app.innerHTML = centered('🤫', 'La collecte est terminée.', 'Le cadre de ' + R.esc(P) + ' est parti en fabrication. Merci d’avoir pensé à ' + pr.lui + ' !');
      return;
    }
    if (ST.full) {
      app.innerHTML = centered('🥹', 'Toutes les places sont prises.', FROM + ' a réuni le maximum de proches pour ' + R.esc(P) + '. Contacte-' + pr.la + ' pour ajouter des places.');
      return;
    }
    var days = ST.daysLeft;
    app.innerHTML = '<div class="view fade"><div class="body" style="padding-top:52px">' +
      '<div class="brand">Ravive</div><div class="brand-tag">Pour ne rien oublier de nous</div>' +
      '<h1 class="lede" style="font-size:23px;margin-top:18px">' + R.esc(FROM) + ' prépare une<br>surprise pour ' + R.esc(P) + ' <span class="heart">♥</span></h1>' +
      (days != null ? '<div class="center-x" style="margin-top:12px"><span class="chip">⏳ ' + (days === 0 ? 'Dernier jour pour participer' : days === 1 ? 'Il te reste 1 jour' : 'Il te reste ' + days + ' jours') + '</span></div>' : '') +
      '<img class="pubimg" style="margin-top:20px" src="' + (ST.visuals && ST.visuals.contributor_hero || '/img/contributor-hero.jpg') + '" alt="">' +
      '<div style="margin-top:20px">' +
        '<div class="how"><div class="n">🎁</div><div><div class="tt">Vous êtes plusieurs, en secret</div><div class="dd">Chacun dépose un petit souvenir pour ' + R.esc(P) + '.</div></div></div>' +
        '<div class="how"><div class="n">🎙️</div><div><div class="tt">Un mot, une voix, une photo</div><div class="dd">Ce que tu veux lui laisser. En 2 minutes.</div></div></div>' +
        '<div class="how"><div class="n">✨</div><div><div class="tt">' + pr.El + ' approche son téléphone de son cadre</div><div class="dd">Et tous vos souvenirs prennent vie, réunis rien que pour ' + pr.lui + '.</div></div></div>' +
      '</div>' +
      '<div class="stack"><button class="btn gold" id="goMoi">Je participe <span class="arrow"></span></button></div>' +
      '</div></div>';
    document.getElementById('goMoi').onclick = function () { go('moi'); };
  };

  /* ------------------------------------------------- 1b. présentations */
  SC.moi = function () {
    var rels = ST.relations || [];
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button><span class="kicker">On fait les présentations</span><h1>Et toi,<br>tu es… ?</h1></div>' +
      '<div class="body">' +
        '<div class="selfiewrap"><div class="selfie" id="selfie">' + (S.selfie ? '<img src="' + S.selfie.url + '" alt="">' : '<span class="cam">📷</span>') + '</div>' +
          '<div class="sfl">' + (S.selfie ? 'Me reprendre' : 'Ajoute une photo de toi') + '</div>' +
          '<div class="sub" style="margin-top:5px">Ton plus beau sourire… ou ta pire grimace.</div></div>' +
        '<div class="field" style="margin-top:18px"><label for="nm">Ton prénom</label><input class="inp" id="nm" value="' + R.esc(S.name) + '" placeholder="Ex. Lucas" maxlength="40" autocomplete="given-name"></div>' +
        '<div style="font-weight:800;font-size:12.5px;margin:16px 0 10px">Et pour ' + R.esc(P) + ', tu es ? <span style="color:var(--muted);font-weight:600">· facultatif</span></div>' +
        '<div class="rchips" id="rels">' + rels.map(function (r) { return '<div class="rchip' + (S.rel === r[0] ? ' on' : '') + '" data-rel="' + r[0] + '">' + R.esc(r[1]) + '</div>'; }).join('') + '</div>' +
        '<p class="error"></p>' +
        '<div class="stack" style="margin-top:24px"><button class="btn gold" id="next" data-busy="Continuer →">Continuer <span class="arrow"></span></button></div>' +
      '</div></div>';
    document.getElementById('back').onclick = function () { go('invite'); };
    document.getElementById('selfie').onclick = function () { fps.click(); };
    document.getElementById('nm').oninput = function () { S.name = this.value; };
    document.getElementById('rels').onclick = function (e) {
      var c = e.target.closest('.rchip');
      if (!c) return;
      S.rel = S.rel === c.dataset.rel ? null : c.dataset.rel;
      render();
    };
    document.getElementById('next').onclick = validMoi;
  };
  function validMoi() {
    var name = (S.name || '').trim();
    if (!name) { fail({ message: 'name' }); app.querySelector('.error').textContent = 'Dis-nous ton prénom.'; return; }
    busy(true, 'Un instant…');
    var p = S.id
      ? api('PATCH', '/contributions/' + S.id, { body: { name: name, relation: S.rel } })
      : api('POST', '/contributions', { body: { name: name, relation: S.rel } }).then(function (r) { S.id = r.id; S.token = r.token; save(); });
    p.then(function () {
      if (S.selfie && S.selfie.blob && !S.selfie.sent) {
        return api('POST', '/contributions/' + S.id + '/selfie', { body: S.selfie.blob, headers: { 'Content-Type': 'image/jpeg' } }).then(function () { S.selfie.sent = true; });
      }
    }).then(function () { busy(false); go('photo'); }).catch(fail);
  }
  fps.onchange = function () {
    var f = fps.files[0]; fps.value = '';
    if (!f) return;
    R.loadImage(f).then(function (l) { return R.shrink(l.img, 800).then(function (s) { S.selfie = { url: URL.createObjectURL(s.blob), blob: s.blob, sent: false }; render(); }); }).catch(fail);
  };

  /* ---------------------------------------------------------- 2. photo */
  var crop = null;
  SC.photo = function () {
    var inner = S.photo && S.photo.pending
      ? '<div class="cropper" id="cropper"></div><input type="range" class="zoom" id="zoom" min="1" max="4" step="0.01" value="1">' +
        '<div class="stack" style="margin-top:14px"><button class="btn gold" id="cropOk" data-busy="Ça me va">Ça me va</button><button class="skip" id="rechoose">Choisir une autre photo</button></div>'
      : S.photo
        ? '<div class="prev"><img src="' + S.photo.url + '" alt=""><button class="re" id="rechoose">Changer</button></div>'
        : '<div class="drop" id="pick"><div class="ic">🖼️</div><div class="tt">Ajouter ma photo</div></div>';
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button><span class="kicker">Une photo</span><h1>Choisis une photo qui<br>raconte quelque chose<br>de vous</h1></div>' +
      '<div class="body">' +
        '<div class="sub" style="margin:-2px 0 18px">Un souvenir, un fou rire, un voyage, un moment complètement banal… choisis celle que tu aimerais qu’' + pr.el + ' garde.</div>' +
        inner +
        '<div class="note"><span class="em">🖼️</span><span>Ta photo rejoindra celles de ses proches pour composer son <b>cadre</b>, l’objet qu’' + pr.el + ' gardera chez ' + pr.lui + '.</span></div>' +
        '<p class="error"></p>' +
        (S.photo && S.photo.pending ? '' : '<div class="stack"><button class="btn" id="next">Continuer <span class="arrow"></span></button></div>') +
        (S.photo ? '' : '<div class="center-x" style="margin-top:12px"><button class="skip" id="later">Plus tard</button></div>') +
      '</div></div>';
    document.getElementById('back').onclick = function () { go('moi'); };
    var pick = document.getElementById('pick'); if (pick) pick.onclick = function () { fp.click(); };
    var re = document.getElementById('rechoose'); if (re) re.onclick = function () { fp.click(); };
    var later = document.getElementById('later'); if (later) later.onclick = function () { go('libre'); };
    var next = document.getElementById('next'); if (next) next.onclick = function () { go('libre'); };
    if (S.photo && S.photo.pending) {
      var box = document.getElementById('cropper');
      crop = R.cropper(box, S.photo.img, S.photo.shrunk);
      document.getElementById('zoom').oninput = function () { crop.setZoom(Number(this.value)); };
      document.getElementById('cropOk').onclick = uploadMainPhoto;
    }
  };
  fp.onchange = function () {
    var f = fp.files[0]; fp.value = '';
    if (!f) return;
    R.loadImage(f).then(function (l) {
      return R.shrink(l.img, 2000).then(function (s) { S.photo = { pending: true, img: l.img, shrunk: s, url: URL.createObjectURL(s.blob) }; render(); });
    }).catch(fail);
  };
  function uploadMainPhoto() {
    var c = crop.getCrop();
    busy(true, 'Envoi…');
    api('POST', '/contributions/' + S.id + '/photo', { body: S.photo.shrunk.blob, headers: { 'Content-Type': 'image/jpeg', 'X-Crop': JSON.stringify(c) } })
      .then(function (r) {
        // aperçu local du carré choisi
        var cv = document.createElement('canvas'); cv.width = cv.height = 600;
        cv.getContext('2d').drawImage(S.photo.img, c.x / S.photo.shrunk.scale, c.y / S.photo.shrunk.scale, c.w / S.photo.shrunk.scale, c.h / S.photo.shrunk.scale, 0, 0, 600, 600);
        S.photo = { url: cv.toDataURL('image/jpeg', 0.85), photoId: r.photoId };
        busy(false); render();
      }).catch(fail);
  }

  /* ----------------------------------------------- zone de réponse */
  var recObj = null;
  function answerArea(ctx) {
    var st = ctx === 'free' ? S.free : S.q;
    if (st.mode === 'choice') {
      return '<button class="choice" data-mode="audio"><span class="em">🎙️</span><span>Laisser un vocal</span></button>' +
        '<button class="choice" data-mode="texte"><span class="em">✍️</span><span>' + (ctx === 'free' ? 'Écrire mon message' : 'Répondre par écrit') + '</span></button>';
    }
    if (st.mode === 'audio') {
      if (st.audio) {
        return '<div class="player"><button class="pbtn" id="playTog">' + (st.playing ? '❚❚' : '▶') + '</button><div class="wave' + (st.playing ? ' on' : '') + '">' + R.bars() + '</div><div class="pt" id="pt">' + R.fmt(st.duration) + '</div></div>' +
          '<div class="prow"><button class="soft" id="resetAudio">↻ Je recommence</button></div>' +
          '<p class="error"></p><button class="btn gold keep" id="keep" data-busy="Ça me va">Ça me va</button>';
      }
      return '<div class="recorder"><button class="mic" id="mic">🎙️</button><div class="wave" id="wave">' + R.bars() + '</div><div class="rectime" id="rt">0:00</div>' +
        '<div class="sub" style="margin-top:6px">Appuie pour parler, appuie encore pour arrêter · ' + R.fmt(MAX_S) + ' max</div></div><p class="error"></p>';
    }
    if (st.mode === 'photo') {
      if (st.photo) return '<div class="prev"><img src="' + st.photo.url + '" alt=""><button class="re" id="clearQPhoto">Changer</button></div><p class="error"></p><button class="btn gold keep" id="keep" data-busy="Ça me va">Ça me va</button>';
      return '<div class="drop" id="pickQPhoto"><div class="ic">📸</div><div class="tt">Choisir une photo</div><div class="sub" style="margin-top:4px">Celle qui répond le mieux</div></div>';
    }
    return '<textarea class="ta" id="ta" placeholder="Écris ce que tu ressens…" maxlength="' + MAX_TXT + '">' + R.esc(st.text) + '</textarea><div class="charcount" id="cc">' + (st.text || '').length + ' / ' + MAX_TXT + '</div>' +
      '<p class="error"></p><button class="btn gold keep" id="keep" data-busy="Ça me va">Ça me va</button>';
  }
  function bindAnswerArea(ctx) {
    var st = ctx === 'free' ? S.free : S.q;
    app.querySelectorAll('.choice[data-mode]').forEach(function (b) { b.onclick = function () { st.mode = b.dataset.mode; st.playing = false; render(); }; });
    var mic = document.getElementById('mic');
    if (mic) mic.onclick = function () { micTog(ctx); };
    var pt = document.getElementById('playTog');
    if (pt) pt.onclick = function () { playTog(ctx); };
    var ra = document.getElementById('resetAudio');
    if (ra) ra.onclick = function () { stopPreview(); st.audio = null; st.duration = 0; st.playing = false; render(); };
    var ta = document.getElementById('ta');
    if (ta) ta.oninput = function () { st.text = this.value; document.getElementById('cc').textContent = this.value.length + ' / ' + MAX_TXT; };
    var pq = document.getElementById('pickQPhoto');
    if (pq) pq.onclick = function () { fpq.click(); };
    var cq = document.getElementById('clearQPhoto');
    if (cq) cq.onclick = function () { S.q.photo = null; render(); };
    var keep = document.getElementById('keep');
    if (keep) keep.onclick = function () { keepAnswer(ctx); };
  }
  function micTog(ctx) {
    var st = ctx === 'free' ? S.free : S.q;
    var mic = document.getElementById('mic'), rt = document.getElementById('rt'), wave = document.getElementById('wave');
    var onResult = function (r) {
      if (!r) { var e = app.querySelector('.error'); if (e) { e.textContent = 'Message trop court, réessaie.'; e.classList.add('show'); } if (mic) mic.classList.remove('rec'); if (wave) wave.classList.remove('on'); return; }
      st.audio = r.blob; st.mime = r.mime; st.duration = r.duration; render();
    };
    if (recObj && recObj.recording()) { recObj.stop().then(onResult); return; }
    var self = R.recorder({
      maxSeconds: MAX_S,
      onTick: function (s) { var el = document.getElementById('rt'); if (el) el.textContent = R.fmt(s); },
      // durée max atteinte : l'enregistrement s'arrête tout seul et ce qui a été dit est conservé
      onAutoStop: function (r) { if (self === recObj && st.audio == null && document.getElementById('mic')) onResult(r); },
    });
    recObj = self;
    if (!recObj.supported) { var e = app.querySelector('.error'); e.textContent = 'Ton navigateur ne permet pas l’enregistrement. Essaie Safari ou Chrome à jour, ou réponds par écrit.'; e.classList.add('show'); return; }
    recObj.start().then(function () {
      mic.classList.add('rec'); wave.classList.add('on');
    }).catch(function () { var e = app.querySelector('.error'); e.textContent = 'Micro inaccessible. Autorise l’accès au micro puis réessaie.'; e.classList.add('show'); });
  }
  var previewAudio = null;
  function stopPreview() { if (previewAudio) { previewAudio.pause(); previewAudio = null; } }
  function playTog(ctx) {
    var st = ctx === 'free' ? S.free : S.q;
    if (st.playing) { stopPreview(); st.playing = false; render(); return; }
    stopPreview();
    previewAudio = new Audio(st.audioUrl || URL.createObjectURL(st.audio));
    st.playing = true; render();
    previewAudio.onended = function () { st.playing = false; render(); };
    previewAudio.ontimeupdate = function () { var el = document.getElementById('pt'); if (el) el.textContent = R.fmt(previewAudio.currentTime) + ' / ' + R.fmt(st.duration); };
    previewAudio.play().catch(function () { st.playing = false; render(); });
  }
  fpq.onchange = function () {
    var f = fpq.files[0]; fpq.value = '';
    if (!f) return;
    R.loadImage(f).then(function (l) { return R.shrink(l.img, 1600).then(function (s) { S.q.photo = { url: URL.createObjectURL(s.blob), blob: s.blob }; render(); }); }).catch(fail);
  };
  function has(st) { return (st.mode === 'audio' && st.audio) || (st.mode === 'texte' && (st.text || '').trim()) || (st.mode === 'photo' && st.photo); }

  // Enregistre le souvenir côté serveur puis avance
  function keepAnswer(ctx) {
    var st = ctx === 'free' ? S.free : S.q;
    if (!has(st)) return;
    stopPreview();
    var meta = ctx === 'free' ? { free: '1' } : { question: S.cur.q, category: S.cur.cat, questionId: S.cur.id };
    var qs = Object.keys(meta).map(function (k) { return k + '=' + encodeURIComponent(meta[k] == null ? '' : meta[k]); }).join('&');
    busy(true, 'Envoi…');
    var req;
    // Modification d'un souvenir existant : on remplace (supprime puis recrée), sauf texte → texte
    var editingId = S.editing === 'free' ? (S.free.memoryId) : (S.editing && S.editing.memoryId);
    var pre = Promise.resolve();
    if (editingId && !(st.mode === 'texte' && st.kind === 'text')) pre = api('DELETE', '/contributions/' + S.id + '/memories/' + editingId);
    req = pre.then(function () {
      if (st.mode === 'texte') {
        if (editingId && st.kind === 'text') return api('PUT', '/contributions/' + S.id + '/memories/' + editingId, { body: { text: st.text } });
        return api('POST', '/contributions/' + S.id + '/memories', { body: Object.assign({ text: st.text }, ctx === 'free' ? { free: true } : { question: S.cur.q, category: S.cur.cat, questionId: S.cur.id }) });
      }
      if (st.mode === 'audio') {
        if (st.audioUrl && !st.audio) return { id: editingId, kind: 'voice', duration: st.duration, audio: st.audioUrl }; // inchangé
        return api('POST', '/contributions/' + S.id + '/memories/audio?duration=' + Math.round(st.duration) + '&' + qs, { body: st.audio, headers: { 'Content-Type': st.mime || 'audio/webm' } });
      }
      if (st.photo.photoUrl && !st.photo.blob) return { id: editingId, kind: 'photo', photo: st.photo.photoUrl };
      return api('POST', '/contributions/' + S.id + '/memories/photo?' + qs, { body: st.photo.blob, headers: { 'Content-Type': 'image/jpeg' } });
    });
    req.then(function (m) {
      var rec = {
        memoryId: m.id, mode: st.mode, kind: m.kind, text: st.text, duration: m.duration || st.duration,
        audioUrl: m.audio || null, photoUrl: m.photo || null, q: ctx === 'free' ? 'Ton mot pour ' + P : S.cur.q,
        ic: ctx === 'free' ? '💌' : S.cur.ic, t: ctx === 'free' ? 'Mot libre' : S.cur.t, free: ctx === 'free',
      };
      busy(false);
      if (ctx === 'free') {
        S.free = Object.assign({}, rec, { mode: st.mode, done: true });
        if (S.editing) { S.editing = null; go('review'); return; }
        go('libre_after');
        return;
      }
      if (S.editing && S.editing.memoryId) {
        var i = S.answered.findIndex(function (a) { return a.memoryId === S.editing.memoryId; });
        if (i >= 0) S.answered[i] = rec; else S.answered.push(rec);
        if (S.starId === S.editing.memoryId) S.starId = rec.memoryId;
        S.editing = null; S.q = freshQ(); go('review'); return;
      }
      S.answered.push(rec);
      S.qptr++;
      S.q = freshQ();
      go('qcont');
    }).catch(fail);
  }
  function freshQ() { return { mode: 'choice', text: '', audio: null, duration: 0, photo: null }; }

  /* ------------------------------------------------------- 3. mot libre */
  SC.libre = function () {
    if (!S.free) S.free = { mode: 'choice', text: '', audio: null, duration: 0 };
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button><span class="kicker">Ton message</span><h1>Tu sais déjà ce<br>que tu veux lui dire ?</h1></div>' +
      '<div class="body"><div class="sub" style="margin-bottom:18px">Dis-lui ce que tu veux, comme tu le veux. Un souvenir, quelques mots, une déclaration, une blague… c’est ton espace.</div>' +
      answerArea('free') +
      (S.free.mode === 'choice' ? '<button class="link" id="ideas">Donne-moi des idées</button>' : '') +
      '</div></div>';
    document.getElementById('back').onclick = function () { if (S.free.mode !== 'choice' && !S.editing) { S.free.mode = 'choice'; render(); } else if (S.editing) { S.editing = null; go('review'); } else go('photo'); };
    var ideas = document.getElementById('ideas'); if (ideas) ideas.onclick = function () { go('qcard'); };
    bindAnswerArea('free');
  };
  SC.libre_after = function () {
    app.innerHTML = centered('💌', 'Ton mot est bien là.',
      '<div style="font-family:Fraunces,serif;font-size:18px;color:var(--ink);margin-bottom:10px">Envie d’aller un peu plus loin ?</div>On t’a préparé quelques questions pour faire remonter un souvenir, une anecdote, ou quelque chose que tu ne lui as peut-être jamais dit.',
      '<button class="btn gold" id="toQ">Découvrir les questions <span class="arrow"></span></button><button class="btn line" id="toPrev">J’ai fini mon souvenir</button>');
    document.getElementById('toQ').onclick = function () { go('qcard'); };
    document.getElementById('toPrev').onclick = function () { go('preview'); };
  };

  /* ------------------------------------------------------ 4. questions */
  function loadQueue() {
    return api('GET', '/questions').then(function (r) {
      S.queue = r.questions.map(function (q) { return { id: q.id, q: q.text, cat: q.category, ic: q.icon, t: q.title }; });
      S.qptr = 0;
    });
  }
  SC.qcard = function () {
    if (!S.queue.length) { app.innerHTML = '<div class="view center"><div class="sub">Chargement…</div></div>'; loadQueue().then(render).catch(fail); return; }
    var n = S.answered.length;
    if (n >= MAXQ) { app.innerHTML = centered('🤎', (MAXQ === 4 ? 'Quatre' : MAXQ) + ' souvenirs.<br>C’est déjà magnifique.', '', '<button class="btn gold" id="toPrev">J’ai fini mon souvenir</button>'); document.getElementById('toPrev').onclick = function () { go('preview'); }; return; }
    if (S.qptr >= S.queue.length) { app.innerHTML = centered('✨', 'Tu les as toutes<br>parcourues.', '', '<button class="btn gold" id="toPrev">J’ai fini mon souvenir</button>'); document.getElementById('toPrev').onclick = function () { go('preview'); }; return; }
    var cur = S.queue[S.qptr]; S.cur = cur;
    var answering = S.q.mode !== 'choice';
    var mid;
    if (!answering) {
      mid = '<div class="qcardbig" id="qc"><div class="bigq">' + R.esc(cur.q) + '</div></div>' +
        '<div class="stack" style="margin-top:20px">' +
          '<button class="btn gold" data-mode="audio">🎙️  Le raconter</button>' +
          '<button class="btn line" data-mode="texte">✍️  L’écrire</button>' +
          '<button class="btn line" data-mode="photo">📸  Le montrer</button>' +
          '<button class="btn pass2" id="pass">↻  Une autre question</button>' +
        '</div>';
    } else {
      mid = '<div class="qbox">' + R.esc(cur.q) + '</div>' + answerArea('q');
    }
    app.innerHTML = '<div class="view fade"><div class="head compact"><button class="backarr" id="back">‹</button><span class="kicker">' + (cur.ic || '') + ' ' + R.esc(cur.t || '') + '</span></div>' +
      '<div class="body" style="padding-top:8px">' +
      (!answering ? (n > 0 ? '<div class="center-x" style="margin-bottom:14px"><span class="counter">' + n + ' / ' + MAXQ + '</span></div>' : '<div class="sub" style="margin:-2px 0 14px">Une question t’inspire ? Réponds. Sinon, passe à la suivante.</div>') : '') +
      mid +
      (!answering ? '<div class="center-x" style="margin-top:18px"><button class="skip" id="stop">' + (n > 0 ? 'J’ai fini mon souvenir' : 'Je m’arrête là') + '</button></div>' : '') +
      '</div></div>';
    document.getElementById('back').onclick = function () {
      if (answering) { stopPreview(); S.q = freshQ(); render(); } else go(S.free && S.free.done ? 'libre_after' : 'libre');
    };
    if (!answering) {
      app.querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { S.q.mode = b.dataset.mode; render(); }; });
      document.getElementById('pass').onclick = passer;
      document.getElementById('stop').onclick = function () { go('preview'); };
      var el = document.getElementById('qc'), x0 = null;
      el.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      el.addEventListener('touchend', function (e) { if (x0 == null) return; if (e.changedTouches[0].clientX - x0 < -55) passer(); x0 = null; });
    } else bindAnswerArea('q');
  };
  function passer() { S.q = freshQ(); S.qptr++; render(); }
  SC.qcont = function () {
    var n = S.answered.length, more = n < MAXQ && S.qptr < S.queue.length;
    app.innerHTML = centered('🤎', 'Souvenir enregistré.', '<span class="counter">' + n + ' / ' + MAXQ + '</span>',
      (more ? '<button class="btn" id="more">Une autre question</button>' : '') + '<button class="btn gold" id="toPrev">J’ai fini mon souvenir</button>');
    var m = document.getElementById('more'); if (m) m.onclick = function () { go('qcard'); };
    document.getElementById('toPrev').onclick = function () { go('preview'); };
  };

  /* ---------------------------------------------- aperçu et relecture */
  function pieces() {
    var l = [];
    if (S.free && S.free.done) l.push(Object.assign({ id: 'free' }, S.free));
    S.answered.forEach(function (a) { l.push(Object.assign({ id: 'a' + a.memoryId }, a)); });
    return l;
  }
  SC.preview = function () {
    var ps = pieces();
    if (!ps.length) { go('review'); return; }
    app.innerHTML = centered('👀', 'Avant d’envoyer…', 'Regarde ce que ' + R.esc(P) + ' verra. Tu pourras encore tout modifier.',
      '<button class="btn gold" id="story">▶  Voir mes souvenirs</button><button class="btn line" id="rev">Aller à la validation</button>');
    document.getElementById('story').onclick = function () { S.mpi = 0; go('mstory'); };
    document.getElementById('rev').onclick = function () { go('review'); };
  };
  var storyPlayer = R.audioPlayer();
  SC.mstory = function () { playMine(S.mpi); };
  function playMine(i) {
    var ps = pieces();
    if (!ps.length) { go('review'); return; }
    storyPlayer.stop();
    var p = ps[i];
    var bars = ps.map(function (_, k) { return '<div class="p"><i style="width:' + (k < i ? '100%' : k === i ? '100%' : '0') + '"></i></div>'; }).join('');
    var bg = p.mode === 'photo' && p.photoUrl ? 'background-image:url(\'' + p.photoUrl + '\')' : S.photo && S.photo.url ? 'background-image:url(\'' + S.photo.url + '\')' : '';
    var inner;
    if (p.mode === 'audio') inner = '<div class="mkick">' + R.esc(p.q) + '</div><div class="mvoice" id="mv"><button class="pl" id="mplay"><svg width="15" height="17" viewBox="0 0 15 17" fill="currentColor"><path d="M2 2 L13 8.5 L2 15 Z"/></svg></button><div class="w">' + R.bars(20) + '</div><div class="d" id="md">' + R.fmt(p.duration) + '</div></div>';
    else if (p.mode === 'photo') inner = '<div class="mkick">' + R.esc(p.q) + '</div><div class="mphotocap">📸 Ta photo</div>';
    else inner = '<div class="mkick">' + R.esc(p.q) + '</div><div class="mnote' + ((p.text || '').length > 220 ? ' long' : '') + '">“ ' + R.esc(p.text) + ' ”</div>';
    app.innerHTML = '<div class="mstory"><div class="bg' + (bg ? '' : ' grad') + '" style="' + bg + '"></div><div class="mveil"></div>' +
      '<div class="mprog">' + bars + '</div>' +
      '<div class="mshead"><div class="mava" style="' + (S.selfie ? 'background-image:url(\'' + S.selfie.url + '\')' : '') + '">' + (S.selfie ? '' : R.esc((S.name || '?')[0])) + '</div><div class="mnm">' + R.esc(S.name || 'Toi') + '</div><button class="mx" id="mx">✕</button></div>' +
      '<div class="msbody">' + inner + '</div>' +
      '<div class="mtaps"><div class="l" id="ml"></div><div class="r" id="mr"></div></div><div class="mtaphint">Touche à droite pour continuer</div></div>';
    document.getElementById('mx').onclick = function () { storyPlayer.stop(); go('review'); };
    document.getElementById('ml').onclick = function () { if (S.mpi > 0) { S.mpi--; playMine(S.mpi); } };
    document.getElementById('mr').onclick = function () { if (S.mpi < ps.length - 1) { S.mpi++; playMine(S.mpi); } else { storyPlayer.stop(); go('review'); } };
    var mp = document.getElementById('mplay');
    if (mp) {
      var playStory = function () {
        var mv = document.getElementById('mv');
        if (storyPlayer.playing()) { storyPlayer.pause(); mv.classList.remove('on'); return; }
        storyPlayer.play(p.audioUrl, {
          onended: function () { mv.classList.remove('on'); },
          ontimeupdate: function () { var d = document.getElementById('md'); if (d) d.textContent = R.fmt(storyPlayer.el.currentTime) + ' / ' + R.fmt(p.duration); },
        }).then(function () { mv.classList.add('on'); }).catch(function () {});
      };
      mp.onclick = function (e) { e.stopPropagation(); playStory(); };
      playStory(); // lecture automatique, comme dans le reveal du destinataire
    }
  }
  SC.review = function () {
    var ps = pieces();
    var rows = ps.map(function (p) {
      var icon = p.mode === 'audio' ? '🎙️' : p.mode === 'texte' ? '✍️' : '📸';
      var prev = p.mode === 'texte' ? ((p.text || '').slice(0, 64) + ((p.text || '').length > 64 ? '…' : '')) : p.mode === 'audio' ? 'Vocal · ' + R.fmt(p.duration) : 'Une photo';
      var st = S.starId === p.memoryId;
      return '<div class="ritem' + (st ? ' star' : '') + '"><div class="ritop"><div class="rmain"><div class="rq">' + icon + ' ' + R.esc(p.q) + '</div><div class="rp">' + R.esc(prev) + '</div></div>' +
        '<button class="rstar' + (st ? ' on' : '') + '" data-star="' + p.memoryId + '" title="Vu en premier">★</button></div>' +
        '<div class="ractions"><button class="ract" data-edit="' + p.id + '">Modifier</button><button class="ract del" data-del="' + p.id + '">Supprimer</button></div></div>';
    }).join('');
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button><span class="kicker">Avant d’envoyer</span><h1>Ton souvenir<br>pour ' + R.esc(P) + '</h1></div>' +
      '<div class="body">' +
        (ps.length > 1 ? '<div class="note" style="margin-top:0;margin-bottom:14px"><span class="em">⭐</span><span>Mets une <b>★</b> sur celui qui compte le plus, c’est celui que ' + R.esc(P) + ' verra en premier.</span></div>' : '') +
        (ps.length ? rows : '<div class="sub" style="margin:18px 0">Tu n’as encore rien laissé.</div>') +
        (!S.photo ? '<div class="note"><span class="em">🖼️</span><span>Tu n’as pas encore ajouté de photo pour le cadre. <button class="skip" id="addPhoto" style="padding:0">Ajouter une photo</button></span></div>' : '') +
        (ps.length < 1 + MAXQ ? '<div class="center-x" style="margin-top:14px"><button class="skip" id="addMore">' + (S.free && S.free.done ? 'Répondre à une question de plus' : 'Écrire un mot libre') + '</button></div>' : '') +
        '<p class="error"></p>' +
        '<div class="stack" style="margin-top:6px"><button class="btn gold" id="send" data-busy="✓ Valider et envoyer"' + (ps.length ? '' : ' disabled') + '>✓ Valider et envoyer</button></div>' +
        (ps.length ? '<div class="center-x" style="margin-top:12px"><button class="skip" id="story">Revoir en story</button></div>' : '') +
      '</div></div>';
    document.getElementById('back').onclick = function () { go(ps.length ? 'preview' : (S.free && S.free.done ? 'libre_after' : 'libre')); };
    app.querySelectorAll('[data-star]').forEach(function (b) { b.onclick = function () { var id = Number(b.dataset.star); S.starId = S.starId === id ? null : id; render(); }; });
    app.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { editP(b.dataset.edit); }; });
    app.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { delP(b.dataset.del); }; });
    var ap = document.getElementById('addPhoto'); if (ap) ap.onclick = function () { go('photo'); };
    var am = document.getElementById('addMore'); if (am) am.onclick = function () { go(S.free && S.free.done ? 'qcard' : 'libre'); };
    var story = document.getElementById('story'); if (story) story.onclick = function () { S.mpi = 0; go('mstory'); };
    document.getElementById('send').onclick = sendAll;
  };
  function delP(id) {
    var p = pieces().find(function (x) { return x.id === id; });
    if (!p || !confirm('Supprimer ce souvenir ?')) return;
    api('DELETE', '/contributions/' + S.id + '/memories/' + p.memoryId).then(function () {
      if (id === 'free') S.free = null; else S.answered = S.answered.filter(function (a) { return a.memoryId !== p.memoryId; });
      if (S.starId === p.memoryId) S.starId = null;
      render();
    }).catch(fail);
  }
  function editP(id) {
    var p = pieces().find(function (x) { return x.id === id; });
    if (!p) return;
    var st = { mode: p.mode, kind: p.kind, text: p.text || '', audio: null, audioUrl: p.audioUrl, duration: p.duration || 0, photo: p.photoUrl ? { url: p.photoUrl, photoUrl: p.photoUrl } : null, playing: false, memoryId: p.memoryId };
    if (id === 'free') { S.editing = 'free'; S.free = Object.assign(S.free, st, { done: true }); go('libre'); return; }
    S.editing = { memoryId: p.memoryId };
    S.cur = { q: p.q, cat: null, ic: p.ic, t: p.t };
    S.q = st;
    go('qedit');
  }
  SC.qedit = function () {
    app.innerHTML = '<div class="view fade"><div class="head compact"><button class="backarr" id="back">‹</button><span class="kicker">' + (S.cur.ic || '') + ' ' + R.esc(S.cur.t || '') + '</span></div>' +
      '<div class="body" style="padding-top:8px"><div class="qbox">' + R.esc(S.cur.q) + '</div>' + answerArea('q') + '</div></div>';
    document.getElementById('back').onclick = function () { stopPreview(); S.editing = null; S.q = freshQ(); go('review'); };
    bindAnswerArea('q');
  };
  function sendAll() {
    busy(true, 'Envoi…');
    api('POST', '/contributions/' + S.id + '/complete', { body: { star: S.starId || null } }).then(function () {
      try { sessionStorage.removeItem(storeKey); } catch (e) { /* rien */ }
      busy(false); go('merci');
    }).catch(fail);
  }
  SC.merci = function () {
    app.innerHTML = centered('🤎', 'Merci d’avoir<br>laissé un peu de toi.',
      'Ton souvenir fait maintenant partie de la surprise de ' + R.esc(P) + '.<br><br>Plus qu’à garder le secret jusqu’au jour J… 🤫');
  };

  /* ------------------------------------------------------ reprise */
  (function resume() {
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(storeKey) || 'null'); } catch (e) { /* rien */ }
    if (!saved || !saved.token || !ST.open) { render(); return; }
    S.id = saved.id; S.token = saved.token; S.name = saved.name || '';
    api('GET', '/contributions/' + S.id + '/memories').then(function (r) {
      r.memories.forEach(function (m) {
        var rec = { memoryId: m.id, mode: m.kind === 'voice' ? 'audio' : m.kind === 'text' ? 'texte' : 'photo', kind: m.kind, text: m.text || '', duration: m.duration, audioUrl: m.audio, photoUrl: m.photo, q: m.free ? 'Ton mot pour ' + P : m.question, ic: m.free ? '💌' : (CATS[m.category] ? CATS[m.category].icon : '✨'), t: m.free ? 'Mot libre' : (CATS[m.category] ? CATS[m.category].title : ''), free: m.free };
        if (m.free && !S.free) S.free = Object.assign({}, rec, { done: true }); else S.answered.push(rec);
      });
      S.starId = r.star;
      if (r.name) S.name = r.name;
      if (r.relation) S.rel = r.relation;
      if (r.photo) S.photo = { url: r.photo.url, photoId: r.photo.photoId };
      if (r.selfie) S.selfie = { url: r.selfie, sent: true };
      S.sc = r.memories.length ? 'review' : 'photo';
      render();
    }).catch(function () { try { sessionStorage.removeItem(storeKey); } catch (e) { /* rien */ } reset(); render(); });
  })();
})();
