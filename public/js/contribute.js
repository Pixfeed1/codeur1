'use strict';

/* ravive — parcours contributeur (maquettes v5 puis finales V1.1), branché sur l'API /api/p/:slug */

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
      q: freshQ(),
      editing: null, starId: null, mpi: 0, busy: false, pickFor: 'q', openSig: false, timer: null,
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
  function render(keep) { var y = window.scrollY; try { SC[S.sc](); } catch (e) { console.error(e); } window.scrollTo(0, keep ? y : 0); }
  function go(x) { if (S.timer) { clearTimeout(S.timer); S.timer = null; } S.sc = x; render(); }
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
      '<div class="brand anim-in">Ravive</div><div class="brand-tag anim-in d1">Pour ne rien oublier de nous</div>' +
      '<h1 class="lede anim-in d1" style="font-size:23px;margin-top:18px">' + R.esc(FROM) + ' prépare une<br>surprise pour ' + R.esc(P) + ' <span class="heart pop">♥</span></h1>' +
      (days != null ? '<div class="center-x anim-in d2" style="margin-top:12px"><span class="chip">⏳ <span id="countdown">' + countdownText() + '</span></span></div>' : '') +
      '<img class="pubimg anim-zoom d3" style="margin-top:20px" src="' + (ST.visuals && ST.visuals.contributor_hero || '/img/contributor-hero.jpg') + '" alt="">' +
      '<div style="margin-top:20px">' +
        '<div class="how anim-in d4"><div class="n">🎁</div><div><div class="tt">Vous êtes plusieurs, en secret</div><div class="dd">Chacun dépose un petit souvenir pour ' + R.esc(P) + '.</div></div></div>' +
        '<div class="how anim-in d5"><div class="n">🎙️</div><div><div class="tt">Un mot, une voix, une photo</div><div class="dd">Ce que tu veux lui laisser. En 2 minutes.</div></div></div>' +
        '<div class="how anim-in d6"><div class="n">✨</div><div><div class="tt">' + pr.El + ' approche son téléphone de son cadre</div><div class="dd">Et tous vos souvenirs prennent vie, réunis rien que pour ' + pr.lui + '.</div></div></div>' +
      '</div>' +
      '<div class="stack anim-in d7"><button class="btn gold" id="goMoi">Je participe <span class="arrow"></span></button></div>' +
      '</div></div>';
    document.getElementById('goMoi').onclick = function () { go('moi'); };
    startCountdown();
  };
  // Compte à rebours réel jusqu'à la fin de collecte (jours · heures · minutes), mis à jour chaque minute
  var cdTimer = null;
  function countdownText() {
    var end = ST.deadline ? new Date(ST.deadline + 'T23:59:59') : null;
    if (!end || isNaN(end)) return ST.daysLeft === 0 ? 'Dernier jour pour participer' : 'Il te reste ' + ST.daysLeft + ' jour' + (ST.daysLeft > 1 ? 's' : '');
    var ms = end - Date.now();
    if (ms <= 0) return 'Dernières heures pour participer';
    var d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000);
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    if (d === 0) return 'Il te reste ' + pad(h) + ' h · ' + pad(m) + ' min';
    return d + ' jour' + (d > 1 ? 's' : '') + ' · ' + pad(h) + ' h · ' + pad(m) + ' min';
  }
  function startCountdown() {
    clearInterval(cdTimer);
    cdTimer = setInterval(function () { var el = document.getElementById('countdown'); if (!el) { clearInterval(cdTimer); return; } el.textContent = countdownText(); }, 30000);
  }

  /* ------------------------------------------------- 1b. présentations */
  SC.moi = function () {
    // La question « tu es… ? » (lien avec la personne fêtée) a été retirée à la demande du client.
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button><span class="kicker">Commençons par toi</span><h1>Et toi,<br>tu es… ?</h1></div>' +
      '<div class="body">' +
        '<div class="selfiewrap"><div class="selfie' + (S.selfie && S.selfie.fresh ? ' arrive' : '') + '" id="selfie">' + (S.selfie ? '<img src="' + S.selfie.url + '" alt="">' : '<span class="cam pop">📷</span>') + '</div>' +
          '<div class="sfl">' + (S.selfie ? 'Me reprendre' : 'À toi de jouer 📷') + '</div>' +
          '<div class="sub" style="margin-top:5px">Ton plus beau sourire… ou ta pire grimace.</div></div>' +
        '<div class="field" style="margin-top:18px"><label for="nm">Ton prénom</label><input class="inp" id="nm" value="' + R.esc(S.name) + '" placeholder="Ex. Lucas" maxlength="40" autocomplete="given-name"></div>' +
        '<p class="error"></p>' +
        '<div class="stack" style="margin-top:24px"><button class="btn gold" id="next" data-busy="Continuer →">Continuer <span class="arrow"></span></button></div>' +
      '</div></div>';
    document.getElementById('back').onclick = function () { go('invite'); };
    document.getElementById('selfie').onclick = function () { fps.click(); };
    document.getElementById('nm').oninput = function () { S.name = this.value; };
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
    R.loadImage(f).then(function (l) { return R.shrink(l.img, 800).then(function (s) { S.selfie = { url: URL.createObjectURL(s.blob), blob: s.blob, sent: false, fresh: true }; render(); S.selfie.fresh = false; }); }).catch(fail);
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

  /* ------------------------------------------------ zone de réponse (V1.1)
     Un souvenir = une voix OU un texte, plus une photo facultative liée au souvenir.
     Le contributeur pose d'abord sa voix ou ses mots (« pièce »), puis peut ajouter
     une photo (recadrage portrait, position de la question, texte clair ou foncé). */
  var recObj = null;
  var ICON_MIC = R.ravIcon('mic', 'var(--vivid)', '#F6EEDF');
  var ICON_MIC_ON = R.ravIcon('mic', '#F6EEDF', 'var(--vivid)');
  var ICON_PEN = R.ravIcon('pen', 'var(--vivid)', '#F6EEDF');
  var ICON_CAM = R.ravIcon('cam', 'var(--vivid)', '#F6EEDF');
  function holder(ctx) { return ctx === 'free' ? S.free : S.q; }
  function hasContent(st) { return !!(st.audio || st.audioUrl || (st.kind === 'text' && (st.text || '').trim()) || (st.mode === 'texte' && (st.text || '').trim())); }
  function hasVoice(st) { return !!(st.audio || (st.audioUrl && st.kind === 'voice')); }
  function hasText(st) { return !hasVoice(st) && !!(st.text || '').trim(); }
  function opt(cls, icon, title, sub, id) {
    return '<button class="opt ' + cls + '" id="' + id + '"><span class="oi">' + icon + '</span><span class="otx"><span class="ot">' + title + '</span><span class="os">' + sub + '</span></span></button>';
  }
  function answerArea(ctx) {
    var st = holder(ctx);
    if (st.mode === 'audio') {
      return '<div class="recorder"><div class="cdov" id="cdov"></div><button class="mic" id="mic">' + ICON_MIC_ON + '</button><div class="wave" id="wave">' + R.bars() + '</div><div class="rectime" id="rt">0:00</div>' +
        '<div class="sub" id="rechelp" style="margin-top:6px">Prépare-toi…</div></div><p class="error"></p>' +
        '<div class="center-x" style="margin-top:12px"><button class="skip" id="cancelPiece">Annuler</button></div>';
    }
    if (st.mode === 'texte') {
      return '<textarea class="ta" id="ta" placeholder="Écris ce que tu ressens…" maxlength="' + MAX_TXT + '">' + R.esc(st.text || '') + '</textarea><div class="charcount" id="cc">' + (st.text || '').length + ' / ' + MAX_TXT + '</div>' +
        '<p class="error"></p><button class="btn keep" id="commitText" data-busy="Continuer">Continuer</button>' +
        '<div class="center-x" style="margin-top:12px"><button class="skip" id="cancelPiece">Annuler</button></div>';
    }
    if (st.mode === 'photo') {
      if (st.photo && st.photo.pending) {
        return '<div class="cropper tall" id="cropper" style="' + screenAspect() + '"></div><input type="range" class="zoom" id="zoom" min="1" max="4" step="0.01" value="1" style="max-width:236px;display:block;margin:12px auto 0">' +
          '<div class="stack" style="margin-top:14px"><button class="btn line" id="rotate">↻ Pivoter</button><button class="btn keep" id="cropOk">Ajouter cette photo</button></div>' +
          '<div class="center-x" style="margin-top:10px"><button class="skip" id="rechooseQ">Changer de photo</button></div>';
      }
      return '<div class="drop" id="pickQPhoto"><div class="ic camsig">' + ICON_CAM + '</div><div class="tt">Choisir une photo</div><div class="sub" style="margin-top:4px">On garde un maximum de l’image</div></div>' +
        '<p class="error"></p><div class="center-x" style="margin-top:12px"><button class="skip" id="cancelPiece">Annuler</button></div>';
    }
    // mode « choice » : rien encore → deux choix ; sinon la pièce posée + photo facultative
    if (!hasContent(st)) {
      return '<div class="opts">' + opt('lead', ICON_MIC, 'Le raconter', 'Enregistrer un vocal', 'optAudio') + opt('', ICON_PEN, 'L’écrire', 'Quelques mots', 'optText') + '</div>' +
        (ctx === 'q' && !S.editing ? '<div class="opts" style="margin-top:11px">' + opt('alt', R.icons.refresh, 'Une autre question', 'Passer à une autre', 'pass') + '</div>' : '');
    }
    var h = hasVoice(st)
      ? '<div class="piece"><button class="miniplay" id="playTog">' + (st.playing ? '❚❚' : '▶') + '</button><div class="pmid"><div class="ptt">Vocal</div><div class="pss" id="pt">' + R.fmt(st.duration) + '</div></div>' +
        '<div class="pacts"><button class="prm" id="redoAudio">Refaire</button><button class="prm" id="removeAudio">Supprimer</button></div></div>'
      : '<div class="piece ptext"><span class="pi">' + ICON_PEN + '</span><div class="ptxt">' + R.esc((st.text || '').trim().length > 90 ? st.text.trim().slice(0, 90) + '…' : st.text.trim()) + '</div>' +
        '<div class="pacts"><button class="prm" id="editText">Modifier</button><button class="prm" id="removeText">Supprimer</button></div></div>';
    h += photoComplement(ctx);
    h += '<p class="error"></p><div class="stack" style="margin-top:16px"><button class="btn keep" id="keep" data-busy="Valider ce souvenir">Valider ce souvenir</button></div>';
    return h;
  }
  function photoComplement(ctx) {
    var st = holder(ctx);
    if (!st.photo) {
      return '<div class="photocomp"><div class="pcq">Une photo pour accompagner ce souvenir ? <span>· facultatif</span></div><button class="btn line" id="addPhoto" style="width:auto;display:inline-flex;padding:11px 18px">Ajouter une photo</button></div>';
    }
    var f = st.photoFocus == null ? 50 : st.photoFocus, pos = st.questionPos === 'bottom' ? 'bottom' : 'top';
    var qtxt = ctx === 'free' ? 'Ton mot pour ' + R.esc(P) : R.esc(S.cur ? S.cur.q : '');
    return '<div class="piece"><img class="pthumb" src="' + st.photo.url + '" style="object-position:50% ' + f + '%" alt=""><div class="pmid"><div class="ptt">Photo</div><div class="pss">En complément</div></div>' +
      '<div class="pacts"><button class="prm" id="changePhoto">Modifier</button><button class="prm" id="removePhoto">Retirer</button></div></div>' +
      '<div class="prev prevphoto' + (st.overlayDark ? ' odark' : '') + '" style="' + screenAspect() + '"><img id="qImg" src="' + st.photo.url + '" style="object-position:50% ' + f + '%" alt=""><div class="qpreview ' + pos + '">' + qtxt + '</div></div>' +
      '<div class="prevcap">Aperçu du cadrage réel dans la story</div>' +
      '<div class="framer"><div class="lbl">Glisse pour cadrer</div><input type="range" id="focus" min="0" max="100" value="' + f + '"></div>' +
      '<div class="qposrow"><span class="lbl">Placer la question :</span><button class="qpos' + (pos === 'top' ? ' on' : '') + '" data-qpos="top">En haut</button><button class="qpos' + (pos === 'bottom' ? ' on' : '') + '" data-qpos="bottom">En bas</button></div>' +
      '<div class="txtcol"><span class="tcl">Texte sur la photo</span><div class="tcbs"><button class="tcb' + (!st.overlayDark ? ' on' : '') + '" data-ov="0">Clair</button><button class="tcb' + (st.overlayDark ? ' on' : '') + '" data-ov="1">Foncé</button></div></div>';
  }
  var qcrop = null;
  // La photo d'un souvenir est cadrée et prévisualisée au format réel de l'écran, pour que la story montre exactement ce cadrage
  function screenAspect() { var r = (window.innerWidth || 390) / (window.innerHeight || 844); return 'aspect-ratio:' + Math.max(0.42, Math.min(0.62, r)).toFixed(3); }
  function bindAnswerArea(ctx) {
    var st = holder(ctx);
    var $ = function (id) { return document.getElementById(id); };
    var on = function (id, fn) { var el = $(id); if (el) el.onclick = fn; };
    on('optAudio', function () { R.prepareMic().catch(function () {}); st.mode = 'audio'; render(); }); // permission micro dans le clic (iOS)
    on('optText', function () { st.mode = 'texte'; render(); });
    on('pass', passer);
    on('cancelPiece', function () { stopRec(); R.releaseMic(); st.mode = 'choice'; if (st.photo && st.photo.pending) st.photo = null; render(); });
    on('mic', function () { micTog(ctx); });
    on('commitText', function () { if (!(st.text || '').trim()) { showErr('Écris quelques mots, ou choisis le vocal.'); return; } st.kind = 'text'; st.mode = 'choice'; render(); });
    var ta = $('ta'); if (ta) { ta.oninput = function () { st.text = this.value; $('cc').textContent = this.value.length + ' / ' + MAX_TXT; }; ta.focus(); }
    on('playTog', function () { playTog(ctx); });
    on('redoAudio', function () { stopPreview(); R.prepareMic().catch(function () {}); st.audio = null; st.audioUrl = null; st.duration = 0; st.playing = false; st.mode = 'audio'; render(); });
    on('removeAudio', function () { stopPreview(); st.audio = null; st.audioUrl = null; st.duration = 0; st.playing = false; st.kind = null; render(); });
    on('editText', function () { st.mode = 'texte'; render(); });
    on('removeText', function () { st.text = ''; st.kind = null; render(); });
    on('addPhoto', function () { S.pickFor = ctx; fpq.click(); });
    on('pickQPhoto', function () { S.pickFor = ctx; fpq.click(); });
    on('rechooseQ', function () { S.pickFor = ctx; fpq.click(); });
    on('changePhoto', function () { S.pickFor = ctx; fpq.click(); });
    on('removePhoto', function () { if (st.photo && st.photo.photoUrl) st.photoRemoved = true; st.photo = null; render(true); });
    var fo = $('focus'); if (fo) fo.oninput = function () { st.photoFocus = Number(this.value); var im = $('qImg'); if (im) im.style.objectPosition = '50% ' + this.value + '%'; };
    app.querySelectorAll('[data-qpos]').forEach(function (b) { b.onclick = function () { st.questionPos = b.dataset.qpos; render(true); }; });
    app.querySelectorAll('[data-ov]').forEach(function (b) { b.onclick = function () { st.overlayDark = b.dataset.ov === '1'; render(true); }; });
    on('keep', function () { keepAnswer(ctx); });
    if (st.mode === 'photo' && st.photo && st.photo.pending) {
      var box = $('cropper');
      qcrop = R.cropper(box, st.photo.img, st.photo.shrunk);
      $('zoom').oninput = function () { qcrop.setZoom(Number(this.value)); };
      on('rotate', function () { rotatePending(st); });
      on('cropOk', function () { commitQPhoto(st); });
    }
    if (st.mode === 'audio' && !st.audio) countThenRec(ctx);
  }
  function showErr(msg) { var e = app.querySelector('.error'); if (e) { e.textContent = msg; e.classList.add('show'); } }
  // 3-2-1 puis enregistrement (maquette) ; le micro doit être autorisé au premier geste
  function countThenRec(ctx) {
    var ov = document.getElementById('cdov'), help = document.getElementById('rechelp');
    if (!ov) return;
    var k = 3;
    ov.classList.add('on');
    ov.textContent = '…';
    R.prepareMic().then(function () {
      (function tick() {
        if (!document.getElementById('cdov')) return;
        if (k === 0) { ov.classList.remove('on'); if (help) help.textContent = 'On t’écoute… appuie pour arrêter · ' + R.fmt(MAX_S) + ' max'; micTog(ctx); return; }
        ov.textContent = k; k--; setTimeout(tick, 470);
      })();
    }).catch(function () {
      ov.classList.remove('on');
      if (help) help.textContent = 'Appuie sur le micro pour autoriser l’enregistrement';
      showErr('Micro inaccessible. Autorise l’accès au micro (Réglages > Safari > Micro) puis appuie sur le micro.');
    });
  }
  function stopRec() { if (recObj && recObj.recording()) recObj.stop(); }
  function micTog(ctx) {
    var st = holder(ctx);
    var mic = document.getElementById('mic'), wave = document.getElementById('wave');
    var onResult = function (r) {
      if (!r) { showErr('Message trop court, réessaie.'); if (mic) mic.classList.remove('rec'); if (wave) wave.classList.remove('on'); var h = document.getElementById('rechelp'); if (h) h.textContent = 'Appuie pour parler'; return; }
      st.audio = r.blob; st.mime = r.mime; st.duration = r.duration; st.audioUrl = null; st.kind = 'voice'; st.mode = 'choice'; render();
    };
    if (recObj && recObj.recording()) { recObj.stop().then(onResult); return; }
    var self = R.recorder({
      maxSeconds: MAX_S,
      onTick: function (s) { var el = document.getElementById('rt'); if (el) el.textContent = R.fmt(s); },
      onAutoStop: function (r) { if (self === recObj && st.audio == null && document.getElementById('mic')) onResult(r); },
    });
    recObj = self;
    if (!recObj.supported) { showErr('Ton navigateur ne permet pas l’enregistrement. Essaie Safari ou Chrome à jour, ou réponds par écrit.'); return; }
    recObj.start().then(function () { if (mic) mic.classList.add('rec'); if (wave) wave.classList.add('on'); })
      .catch(function () { showErr('Micro inaccessible. Autorise l’accès au micro puis réessaie.'); var h = document.getElementById('rechelp'); if (h) h.textContent = 'Appuie sur le micro pour réessayer'; });
  }
  var previewAudio = null;
  function stopPreview() { if (previewAudio) { previewAudio.pause(); previewAudio = null; } }
  function playTog(ctx) {
    var st = holder(ctx);
    if (st.playing) { stopPreview(); st.playing = false; render(true); return; }
    stopPreview();
    previewAudio = new Audio(st.audio ? URL.createObjectURL(st.audio) : st.audioUrl);
    st.playing = true; render(true);
    previewAudio.onended = function () { st.playing = false; render(true); };
    previewAudio.ontimeupdate = function () { var el = document.getElementById('pt'); if (el) el.textContent = R.fmt(previewAudio.currentTime) + ' / ' + R.fmt(st.duration); };
    previewAudio.play().catch(function () { st.playing = false; render(true); });
  }
  // Photo du souvenir : choix → recadrage portrait → aperçu local
  fpq.onchange = function () {
    var f = fpq.files[0]; fpq.value = '';
    if (!f) return;
    var st = holder(S.pickFor || 'q');
    R.loadImage(f).then(function (l) {
      return R.shrink(l.img, 1800).then(function (s) { st.photo = { pending: true, img: l.img, shrunk: s, url: URL.createObjectURL(s.blob) }; st.mode = 'photo'; render(); });
    }).catch(fail);
  };
  function rotatePending(st) {
    var img = st.photo.img;
    var cv = document.createElement('canvas'); cv.width = img.naturalHeight || img.height; cv.height = img.naturalWidth || img.width;
    var g = cv.getContext('2d'); g.translate(cv.width / 2, cv.height / 2); g.rotate(Math.PI / 2); g.drawImage(img, -cv.height / 2, -cv.width / 2);
    var ni = new Image();
    ni.onload = function () { R.shrink(ni, 1800).then(function (s) { st.photo = { pending: true, img: ni, shrunk: s, url: URL.createObjectURL(s.blob) }; render(); }); };
    ni.src = cv.toDataURL('image/jpeg', 0.92);
  }
  function commitQPhoto(st) {
    var c = qcrop.getCrop(), sc = st.photo.shrunk.scale;
    var cv = document.createElement('canvas'); cv.width = 540; cv.height = Math.round(540 * c.h / c.w);
    cv.getContext('2d').drawImage(st.photo.img, c.x / sc, c.y / sc, c.w / sc, c.h / sc, 0, 0, cv.width, cv.height);
    st.photo = { blob: st.photo.shrunk.blob, crop: c, url: cv.toDataURL('image/jpeg', 0.85), sent: false };
    st.photoFocus = 50; st.questionPos = st.questionPos || 'top';
    st.mode = 'choice'; render();
  }
  // Si la photo vient du serveur (reprise / modification), on la récupère pour la ré-envoyer
  function ensurePhotoBlob(st) {
    if (!st.photo || st.photo.blob || !st.photo.fullUrl) return Promise.resolve();
    return fetch(st.photo.fullUrl).then(function (r) { return r.blob(); }).then(function (b) { st.photo.blob = b; st.photo.crop = null; });
  }

  // Enregistre le souvenir côté serveur (contenu, puis photo et options) puis avance
  function keepAnswer(ctx) {
    var st = holder(ctx);
    if (!hasContent(st)) return;
    stopPreview();
    R.releaseMic();
    var isFree = ctx === 'free';
    var meta = isFree ? { free: '1' } : { question: S.cur.q, category: S.cur.cat, questionId: S.cur.id };
    var qs = Object.keys(meta).map(function (k) { return k + '=' + encodeURIComponent(meta[k] == null ? '' : meta[k]); }).join('&');
    busy(true, 'Envoi…');
    var editingId = st.memoryId || null;
    var voice = hasVoice(st);
    var keepsServerVoice = voice && !st.audio && st.audioUrl; // vocal inchangé
    var needsNew = !editingId || (voice && !keepsServerVoice) || (st.kind === 'photo');
    var photoMustReupload = needsNew && editingId && st.photo && !st.photo.blob;
    var chain = photoMustReupload ? ensurePhotoBlob(st) : Promise.resolve();
    chain = chain.then(function () {
      if (needsNew && editingId) return api('DELETE', '/contributions/' + S.id + '/memories/' + editingId);
    }).then(function () {
      if (voice) {
        if (keepsServerVoice) return api('GET', '/contributions/' + S.id + '/memories').then(function (r) { return r.memories.filter(function (m) { return m.id === editingId; })[0]; });
        return api('POST', '/contributions/' + S.id + '/memories/audio?duration=' + Math.round(st.duration) + '&' + qs, { body: st.audio, headers: { 'Content-Type': st.mime || 'audio/webm' } });
      }
      if (editingId && !needsNew) return api('PUT', '/contributions/' + S.id + '/memories/' + editingId, { body: { text: st.text } });
      return api('POST', '/contributions/' + S.id + '/memories', { body: Object.assign({ text: st.text }, isFree ? { free: true } : { question: S.cur.q, category: S.cur.cat, questionId: S.cur.id }) });
    }).then(function (m) {
      var mid = m.id;
      var p = Promise.resolve(m);
      if (st.photo && st.photo.blob && !st.photo.sent) {
        p = p.then(function () {
          var headers = { 'Content-Type': 'image/jpeg' };
          if (st.photo.crop) headers['X-Crop'] = JSON.stringify(st.photo.crop);
          return api('POST', '/contributions/' + S.id + '/memories/' + mid + '/photo?focus=' + (st.photoFocus == null ? 50 : st.photoFocus), { body: st.photo.blob, headers: headers });
        }).then(function () { st.photo.sent = true; });
      } else if (!st.photo && st.photoRemoved && !needsNew) {
        p = p.then(function () { return api('DELETE', '/contributions/' + S.id + '/memories/' + mid + '/photo'); });
      }
      if (st.photo) p = p.then(function () { return api('PUT', '/contributions/' + S.id + '/memories/' + mid, { body: { photoFocus: st.photoFocus == null ? 50 : st.photoFocus, questionPos: st.questionPos || 'top', overlayDark: !!st.overlayDark } }); });
      else p = p.then(function () { return m; });
      return p;
    }).then(function (m) {
      var rec = recFrom(m, isFree ? null : S.cur);
      busy(false);
      st.photoRemoved = false;
      if (isFree) {
        S.free = Object.assign({ mode: 'choice', done: true }, rec);
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
  // Représentation locale d'un souvenir à partir de la réponse de l'API
  function recFrom(m, cur) {
    var cat = m.category || (cur && cur.cat) || null;
    return {
      memoryId: m.id, kind: m.kind, mode: 'choice', text: m.text || '', duration: m.duration || 0, audioUrl: m.audio || null, audio: null,
      photo: m.photo ? { url: m.photo, photoUrl: m.photo, fullUrl: m.photoFull, sent: true } : null,
      photoFocus: m.photoFocus == null ? 50 : m.photoFocus, questionPos: m.questionPos || 'top', overlayDark: !!m.overlayDark,
      q: m.free ? 'Ton mot pour ' + P : (m.question || (cur && cur.q) || ''), cat: cat,
      ic: m.free ? '💌' : (CATS[cat] ? CATS[cat].icon : '✨'), t: m.free ? 'Mot libre' : (CATS[cat] ? CATS[cat].title : ''), free: !!m.free,
    };
  }
  function freshQ() { return { mode: 'choice', kind: null, text: '', audio: null, audioUrl: null, duration: 0, photo: null, photoFocus: 50, questionPos: 'top', overlayDark: false, playing: false }; }

  /* ------------------------------------------------------- 3. mot libre */
  SC.libre = function () {
    if (!S.free) S.free = freshQ();
    var st = S.free, u = R.universe('free'), editing = st.mode !== 'choice';
    app.innerHTML = '<div class="view fade themed" style="' + R.universeVars(u) + '"><div class="head"><button class="backarr" id="back">‹</button><span class="kicker">Ton message</span><h1>Ton mot libre<br>pour ' + R.esc(P) + '</h1></div>' +
      '<div class="body">' +
      (editing || hasContent(st) ? '' : '<div class="sub" style="margin-bottom:16px">Raconte ou écris ce que tu veux, tu pourras y ajouter une photo.</div>') +
      answerArea('free') +
      (editing || hasContent(st) ? '' : '<button class="link" id="ideas">Ou découvre les questions</button>') +
      '</div></div>';
    document.getElementById('back').onclick = function () { if (st.mode !== 'choice') { stopRec(); R.releaseMic(); st.mode = 'choice'; if (st.photo && st.photo.pending) st.photo = null; render(); } else if (S.editing) { S.editing = null; go('review'); } else go('photo'); };
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
    var st = S.q, u = R.universe(cur.cat);
    var choosing = st.mode === 'choice' && !hasContent(st);
    var swap = S.cardSwap; S.cardSwap = false;
    var mid = choosing
      ? '<div class="qcardbig themed' + (swap ? ' card-in' : ' qflip') + '" id="qc"><div class="bigq">' + R.esc(cur.q) + '</div></div>' + answerArea('q')
      : '<div class="qbox" style="background:var(--soft);border-color:transparent">' + R.esc(cur.q) + '</div>' + answerArea('q');
    app.innerHTML = '<div class="view themed' + (swap ? '' : ' fade') + '" style="' + R.universeVars(u) + '"><div class="head compact"><button class="backarr" id="back">‹</button><span class="kicker">' + R.esc(cur.t || '') + '</span></div>' +
      '<div class="body" style="padding-top:8px">' +
      (choosing ? (n > 0 ? '<div class="center-x" style="margin-bottom:14px"><span class="counter">' + n + ' sur ' + MAXQ + '</span></div>' : '<div class="sub" style="margin:-2px 0 14px">Ajoute ce que tu veux : une voix ou un mot, et une photo si tu veux.</div>') : '') +
      mid +
      (choosing ? '<div class="center-x" style="margin-top:16px"><button class="skip" id="stop">' + (n > 0 ? 'J’ai fini mon souvenir' : 'Je m’arrête là') + '</button></div>' : '') +
      '</div></div>';
    document.getElementById('back').onclick = function () {
      if (st.mode !== 'choice') { stopRec(); R.releaseMic(); stopPreview(); st.mode = 'choice'; if (st.photo && st.photo.pending) st.photo = null; render(); }
      else if (hasContent(st)) { if (confirm('Abandonner ce souvenir ?')) { stopPreview(); S.q = freshQ(); render(); } }
      else go(S.free && S.free.done ? 'libre_after' : 'libre');
    };
    if (choosing) {
      document.getElementById('stop').onclick = confirmStop;
      var el = document.getElementById('qc'), x0 = null;
      el.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      el.addEventListener('touchend', function (e) { if (x0 == null) return; if (e.changedTouches[0].clientX - x0 < -55) passer(); x0 = null; });
    }
    bindAnswerArea('q');
  };
  function confirmStop() {
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="box"><h2>Tu as terminé ?</h2><div class="sub" style="margin-bottom:16px">Tu vas relire tes souvenirs avant l’envoi. Tu pourras encore les modifier, ou en ajouter un autre.</div>' +
      '<div class="stack"><button class="btn gold" id="stopYes">Oui, voir mes souvenirs</button><button class="btn line" id="stopNo">Non, continuer</button></div></div>';
    document.body.appendChild(m);
    m.querySelector('#stopYes').onclick = function () { m.remove(); go('preview'); };
    m.querySelector('#stopNo').onclick = function () { m.remove(); };
  }
  function passer() {
    var card = document.getElementById('qc');
    if (S.passing) return;
    S.passing = true;
    if (card) card.classList.add('card-out');
    setTimeout(function () { S.passing = false; S.q = freshQ(); S.qptr++; S.cardSwap = true; render(true); }, 220);
  }
  SC.qcont = function () {
    var n = S.answered.length, more = n < MAXQ && S.qptr < S.queue.length;
    app.innerHTML = centered('<span class="heart" style="display:inline-block;width:44px">' + R.icons.heartFull + '</span>', 'Et un souvenir de plus<br>pour ' + R.esc(P) + '.', '<span class="counter">' + n + ' sur ' + MAXQ + '</span>',
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
    app.innerHTML = centered('<span class="heart pop" style="display:inline-block;width:46px">' + R.icons.heartFull + '</span>', 'Ton souvenir<br>est prêt.', 'Tu veux voir ce que ' + R.esc(P) + ' découvrira ?',
      '<button class="btn gold" id="story">Voir mon souvenir</button>') + '';
    document.getElementById('story').onclick = function () { S.mpi = 0; S.openSig = true; go('mstory'); };
    var c = app.querySelector('.stack'); if (c) c.insertAdjacentHTML('afterend', '<div class="center-x" style="margin-top:14px"><button class="skip" id="rev">Passer directement à l’envoi</button></div>');
    document.getElementById('rev').onclick = function () { go('review'); };
  };
  var storyPlayer = R.audioPlayer();
  var stopHalo = null;
  function killStory() { if (stopHalo) { stopHalo(); stopHalo = null; } storyPlayer.stop(); }
  SC.mstory = function () {
    if (S.openSig) { S.openSig = false; S.timer = R.opening(app, 'Un souvenir pour ' + P, function () { if (S.sc === 'mstory') playMine(0); }); return; }
    playMine(S.mpi);
  };
  function itemOf(p) {
    return {
      hasAudio: p.kind === 'voice' || !!p.audio, hasText: p.kind === 'text' && !!(p.text || '').trim(), hasPhoto: !!p.photo,
      text: p.text, duration: p.duration, photoFull: p.photo ? (p.photo.fullUrl || p.photo.url) : null, photoFocus: p.photoFocus, questionPos: p.questionPos, overlayDark: p.overlayDark,
      category: p.cat, free: p.free, question: p.free ? '' : p.q,
    };
  }
  function playMine(i) {
    killStory();
    var ps = pieces();
    if (!ps.length) { go('review'); return; }
    var p = ps[i];
    var v = R.storyView(itemOf(p), { kickVoice: p.free ? 'Ton mot pour ' + P : 'Un souvenir pour ' + P, kickText: 'Ton mot pour ' + P, kickPhoto: 'Ton souvenir en image', signature: S.name });
    var bars = ps.map(function (_, k) { return '<div class="p"><i style="width:' + (k <= i ? '100%' : '0') + '"></i></div>'; }).join('');
    var av = S.selfie ? 'background-image:url(\'' + S.selfie.url + '\')' : 'background:var(--gold);color:#fff';
    app.innerHTML = '<div class="mstory ' + v.cls + '" style="' + v.style + '">' + v.html +
      '<div class="mprog">' + bars + '</div>' +
      '<div class="mshead"><div class="mava" style="' + av + '">' + (S.selfie ? '' : R.esc((S.name || '?')[0])) + '</div><div class="mhinfo"><span class="n2">' + R.esc(S.name || 'Toi') + '</span><span class="s2">pour ' + R.esc(P) + '</span></div><button class="mx" id="mx">' + R.icons.x + '</button></div>' +
      '<div class="mtaps"><div class="l" id="ml"></div><div class="r" id="mr"></div></div></div>';
    document.getElementById('mx').onclick = function () { killStory(); go('review'); };
    document.getElementById('ml').onclick = function () { if (S.mpi > 0) { S.mpi--; playMine(S.mpi); } };
    document.getElementById('mr').onclick = function () { if (S.mpi < ps.length - 1) { S.mpi++; playMine(S.mpi); } else { killStory(); go('review'); } };
    R.bindTextPanel();
    if (v.halo) {
      var url = p.audio ? URL.createObjectURL(p.audio) : p.audioUrl;
      var paused = false, btn = document.getElementById('mpauseBtn');
      storyPlayer.play(url, {}).catch(function () { paused = true; if (btn) btn.innerHTML = R.icons.play; });
      stopHalo = R.halo(function () { return storyPlayer.level(); }, function () { return storyPlayer.el.currentTime || 0; }, function () { return p.duration || storyPlayer.el.duration || 1; }, function () { return paused || storyPlayer.el.paused; });
      if (btn) btn.onclick = function (e) {
        e.stopPropagation();
        if (storyPlayer.el.paused) { paused = false; storyPlayer.el.play().catch(function () {}); btn.innerHTML = R.icons.pause; }
        else { paused = true; storyPlayer.pause(); btn.innerHTML = R.icons.play; }
      };
    }
  }
  SC.review = function () {
    killStory();
    var ps = pieces();
    var rows = ps.map(function (p) {
      var hA = p.kind === 'voice' || !!p.audio, hT = p.kind === 'text' && (p.text || '').trim(), hP = !!p.photo;
      var icon = (hP ? '📸' : '') + (hA ? '🎙️' : '') + (hT ? '✍️' : '');
      var parts = [];
      if (hP) parts.push('Photo');
      if (hA) parts.push('Vocal · ' + R.fmt(p.duration));
      if (hT) parts.push('« ' + (p.text || '').trim().slice(0, 54) + ((p.text || '').trim().length > 54 ? '…' : '') + ' »');
      var st = S.starId === p.memoryId;
      return '<div class="ritem' + (st ? ' star' : '') + '"><div class="ritop"><div class="rmain"><div class="rq">' + icon + ' ' + R.esc(p.q) + '</div><div class="rp">' + R.esc(parts.join(' · ')) + '</div></div>' +
        '<button class="rstar' + (st ? ' on' : '') + '" data-star="' + p.memoryId + '" title="Vu en premier">★</button></div>' +
        '<div class="ractions"><button class="ract" data-edit="' + p.id + '">Modifier</button><button class="ract del" data-del="' + p.id + '">Supprimer</button></div></div>';
    }).join('');
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button><span class="kicker">Avant d’envoyer</span><h1>Ton souvenir<br>pour ' + R.esc(P) + '</h1></div>' +
      '<div class="body">' +
        (ps.length > 1 ? '<div class="note" style="margin-top:0;margin-bottom:14px"><span class="em" style="color:var(--gold);display:inline-block;width:18px">' + R.icons.star + '</span><span>Mets une <b style="color:var(--gold)">★</b> sur celui qui compte le plus, c’est celui que ' + R.esc(P) + ' verra en premier.</span></div>' : '') +
        (ps.length ? rows : '<div class="sub" style="margin:18px 0">Tu n’as encore rien laissé.</div>') +
        (!S.photo ? '<div class="note"><span class="em">🖼️</span><span>Tu n’as pas encore ajouté de photo pour le cadre. <button class="skip" id="addPhoto" style="padding:0">Ajouter une photo</button></span></div>' : '') +
        (ps.length < 1 + MAXQ ? '<div class="center-x" style="margin-top:14px"><button class="skip" id="addMore">' + (S.free && S.free.done ? 'Répondre à une question de plus' : 'Écrire un mot libre') + '</button></div>' : '') +
        '<p class="error"></p>' +
        '<div class="stack" style="margin-top:6px"><button class="btn gold" id="send" data-busy="✓ Valider et envoyer"' + (ps.length ? '' : ' disabled') + '>✓ Valider et envoyer</button></div>' +
        (ps.length ? '<div class="center-x" style="margin-top:12px"><button class="skip" id="story">Revoir en story</button></div>' : '') +
      '</div></div>';
    document.getElementById('back').onclick = function () { go(ps.length ? 'preview' : (S.free && S.free.done ? 'libre_after' : 'libre')); };
    app.querySelectorAll('[data-star]').forEach(function (b) { b.onclick = function () { var id = Number(b.dataset.star); S.starId = S.starId === id ? null : id; render(true); }; });
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
    var st = Object.assign(freshQ(), {
      kind: p.kind === 'photo' ? null : p.kind, text: p.text || '', audioUrl: p.kind === 'voice' ? p.audioUrl : null, duration: p.duration || 0,
      photo: p.photo ? { url: p.photo.url, photoUrl: p.photo.photoUrl, fullUrl: p.photo.fullUrl, sent: true } : null,
      photoFocus: p.photoFocus, questionPos: p.questionPos, overlayDark: p.overlayDark, memoryId: p.memoryId,
    });
    if (p.kind === 'photo') st.legacyPhoto = true;
    if (id === 'free') { S.editing = 'free'; S.free = Object.assign({}, p, st, { done: true }); go('libre'); return; }
    S.editing = { memoryId: p.memoryId };
    S.cur = { q: p.q, cat: p.cat, ic: p.ic, t: p.t, id: null };
    S.q = st;
    go('qedit');
  }
  SC.qedit = function () {
    var u = R.universe(S.cur.cat);
    app.innerHTML = '<div class="view fade themed" style="' + R.universeVars(u) + '"><div class="head compact"><button class="backarr" id="back">‹</button><span class="kicker">' + R.esc(S.cur.t || '') + '</span></div>' +
      '<div class="body" style="padding-top:8px"><div class="qbox" style="background:var(--soft);border-color:transparent">' + R.esc(S.cur.q) + '</div>' + answerArea('q') + '</div></div>';
    document.getElementById('back').onclick = function () { if (S.q.mode !== 'choice') { stopRec(); R.releaseMic(); S.q.mode = 'choice'; if (S.q.photo && S.q.photo.pending) S.q.photo = null; render(); return; } stopPreview(); S.editing = null; S.q = freshQ(); go('review'); };
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
    app.innerHTML = '<div class="view center merci"><div class="seal-anim"><svg viewBox="0 0 120 120" width="120" height="120"><circle class="ring" cx="60" cy="60" r="52" fill="none" stroke="#BC5A44" stroke-width="2"/><path class="check" d="M38 62 L54 78 L84 46" fill="none" stroke="#BC5A44" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<h1 class="lede anim-in d3" style="margin-top:18px">C’est envoyé.</h1>' +
      '<div class="sub anim-in d4" style="margin-top:12px;max-width:290px">Merci d’avoir laissé un peu de toi. Ton souvenir fait maintenant partie de la surprise de ' + R.esc(P) + '.</div>' +
      '<div class="sub anim-in d5" style="margin-top:14px">Plus qu’à garder le secret jusqu’au jour J… 🤫</div>' +
      '<div class="signature anim-in d7">Ravive</div></div>';
  };

  /* ------------------------------------------------------ reprise */
  (function resume() {
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(storeKey) || 'null'); } catch (e) { /* rien */ }
    if (!saved || !saved.token || !ST.open) { render(); return; }
    S.id = saved.id; S.token = saved.token; S.name = saved.name || '';
    api('GET', '/contributions/' + S.id + '/memories').then(function (r) {
      r.memories.forEach(function (m) {
        var rec = recFrom(m, null);
        if (m.free && !S.free) S.free = Object.assign({ mode: 'choice', done: true }, rec); else S.answered.push(rec);
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
