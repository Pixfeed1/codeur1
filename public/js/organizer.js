'use strict';

/* ravive — parcours organisateur (maquette v3, achat via Shopify), branché sur /api/o/:token */

(function () {
  var R = window.RV;
  var D = window.RAVIVE_STATE || {};
  var app = document.getElementById('app');
  var fpo = document.getElementById('fpo');
  var api = function (method, path, opts) { return R.api(method, '/api/o/' + D.token + path, opts); };
  var S = { sc: 'intro', form: {}, sel: [], tpl: null, frameText: '', busy: false };
  var svgSeq = 0;

  function esc(s) { return R.esc(s); }
  function render() { try { SC[S.sc](); } catch (e) { console.error(e); } window.scrollTo(0, 0); }
  function go(x) { S.sc = x; render(); }
  function P() { return D.project.recipientName || 'votre proche'; }
  function pr() { return R.pron(D.project.recipientGender); }
  function refresh() { return api('GET', '').then(function (d) { D = d; }); }
  function fail(err) {
    var msg = err && err.message === 'sealed' ? 'Le projet est scellé, il ne peut plus être modifié.' : err && err.message === 'composition_incomplete' ? 'Il manque des photos pour remplir le cadre.' : 'Une erreur est survenue. Vérifie ta connexion et réessaie.';
    var box = app.querySelector('.error');
    if (box) { box.textContent = msg; box.classList.add('show'); } else alert(msg);
    setBusy(false);
  }
  function setBusy(on) { S.busy = on; app.querySelectorAll('button[data-busy]').forEach(function (b) { b.disabled = on; }); }
  function steps(i, t) { var o = ''; for (var k = 0; k < t; k++) o += '<i class="' + (k <= i ? 'on' : '') + '"></i>'; return '<div class="steps">' + o + '</div>'; }
  function centered(em, title, sub, buttons) {
    return '<div class="view center fade"><div style="font-size:44px">' + em + '</div><h1 class="lede" style="font-size:24px;margin-top:12px">' + title + '</h1>' +
      (sub ? '<div class="sub" style="max-width:285px;margin-top:12px">' + sub + '</div>' : '') + (buttons ? '<div class="stack" style="margin-top:26px;width:100%">' + buttons + '</div>' : '') + '</div>';
  }
  var SC = {};

  if (D.error) {
    app.innerHTML = centered('🔗', 'Ce lien n’est plus valide.', 'Il a peut-être été remplacé par un nouveau lien. Demande-en un autre avec l’adresse email de ta commande.', '<a class="btn gold" href="/acces">Recevoir un nouveau lien</a>');
    return;
  }

  /* ------------------------------------------------------------ intro */
  SC.intro = function () {
    if (D.project.setupDone) { go('dashboard'); return; }
    app.innerHTML = '<div class="view center fade"><div class="brand">Ravive</div>' +
      '<h1 class="lede" style="margin-top:22px">Offrez un cadeau<br>inoubliable</h1>' +
      '<div class="sub" style="max-width:285px">Un cadre composé des photos de ses proches, qui s’anime de tous leurs messages quand on approche un téléphone.</div>' +
      '<div class="note" style="max-width:300px"><span class="em">🎁</span><span>Votre formule réunit jusqu’à <b>' + D.project.capacity + ' proches</b>. Créez l’espace souvenir en deux minutes.</span></div>' +
      '<div class="stack" style="max-width:260px;margin-top:28px;width:100%"><button class="btn gold" id="start">Créer mon cadeau <span class="arrow"></span></button></div></div>';
    document.getElementById('start').onclick = function () { go('infos'); };
  };

  /* ------------------------------------------------------------ infos */
  function form() {
    if (!S.form.loaded) {
      S.form = { loaded: true, recipient_name: D.project.recipientName || '', event_date: D.project.eventDate || '', recipient_gender: D.project.recipientGender || 'f',
        organizer_name: D.project.organizerName || '', occasion: D.project.occasion || '', deadline: D.project.deadline || '' };
    }
    return S.form;
  }
  SC.infos = function () {
    var f = form();
    var gs = [['f', 'Elle'], ['m', 'Il'], ['autre', 'Autre']];
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button>' + steps(0, 3) + '<span class="kicker">Étape 1</span><h1>Parle-nous<br>de la fête</h1></div>' +
      '<div class="body">' +
        '<div class="field"><label>Le prénom du / de la fêté·e</label><input class="inp" id="fName" value="' + esc(f.recipient_name) + '" placeholder="Ex. Léa" maxlength="40"></div>' +
        '<div class="field"><label>On parle de…</label><div class="gchips" id="gchips">' + gs.map(function (g) { return '<div class="gchip' + (f.recipient_gender === g[0] ? ' on' : '') + '" data-g="' + g[0] + '">' + g[1] + '</div>'; }).join('') + '</div></div>' +
        '<div class="field"><label>L’occasion <span style="color:var(--muted);font-weight:600">· facultatif</span></label><input class="inp" id="fOcc" value="' + esc(f.occasion) + '" placeholder="Anniversaire, mariage, départ…" maxlength="60"></div>' +
        '<div class="field"><label>Date de l’événement</label><input class="inp" id="fDate" type="date" value="' + esc(f.event_date) + '"></div>' +
        '<div class="field"><label>De la part de</label><input class="inp" id="fFrom" value="' + esc(f.organizer_name) + '" placeholder="Ton prénom" maxlength="40"><div class="hintline">Le prénom affiché sur l’invitation envoyée aux proches.</div></div>' +
        '<p class="error"></p>' +
        '<div class="stack"><button class="btn" id="next">Continuer <span class="arrow"></span></button></div>' +
      '</div></div>';
    document.getElementById('back').onclick = function () { go(D.project.setupDone ? 'dashboard' : 'intro'); };
    document.getElementById('gchips').onclick = function (e) { var c = e.target.closest('.gchip'); if (c) { f.recipient_gender = c.dataset.g; render(); } };
    ['fName', 'fOcc', 'fDate', 'fFrom'].forEach(function (id) {
      var key = { fName: 'recipient_name', fOcc: 'occasion', fDate: 'event_date', fFrom: 'organizer_name' }[id];
      document.getElementById(id).oninput = function () { f[key] = this.value; };
    });
    document.getElementById('next').onclick = function () {
      if (!f.recipient_name.trim()) { var e = app.querySelector('.error'); e.textContent = 'Indique le prénom de la personne fêtée.'; e.classList.add('show'); return; }
      if (!f.organizer_name.trim()) { var e2 = app.querySelector('.error'); e2.textContent = 'Indique ton prénom, il apparaît sur l’invitation.'; e2.classList.add('show'); return; }
      go('cloture');
    };
  };

  /* ---------------------------------------------------------- clôture */
  function reco(f) {
    var today = R.todayISO();
    if (!f.event_date) return R.addDays(today, 14);
    var r = R.addDays(f.event_date, -10);
    return r > today ? r : today;
  }
  SC.cloture = function () {
    var f = form();
    var today = R.todayISO();
    var rec = reco(f);
    if (!f.deadline) f.deadline = rec;
    var delivery = R.addDays(f.deadline || today, D.project.fabricationDays || 7);
    var check = '';
    if (f.event_date) {
      check = delivery <= f.event_date ? '<div class="okline">✓ Livraison prévue avant le ' + R.fmtShort(f.event_date) + '</div>' : '<div class="warnline">⚠ Risque d’être juste : avance la fin de collecte pour recevoir le cadre à temps</div>';
    }
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button>' + steps(1, 3) + '<span class="kicker">Étape 2 · La clôture</span><h1>Jusqu’à quand<br>collecter les souvenirs ?</h1></div>' +
      '<div class="body">' +
        '<div class="note" style="margin-top:0"><span class="em">💡</span><span>On te recommande le <b>' + R.fmtShort(rec) + '</b>, environ 10 jours avant l’événement, pour avoir le temps de fabriquer et livrer.</span></div>' +
        '<div class="field" style="margin-top:14px"><label>Fin de la collecte</label><input class="inp" id="fDeadline" type="date" value="' + esc(f.deadline) + '" min="' + today + '"></div>' +
        '<button class="btn line" style="width:auto;padding:9px 14px;font-size:13px" id="useReco">Utiliser la date recommandée</button>' +
        '<div class="estimate" style="margin-top:16px"><div class="bx">📦</div><div><div class="k">Livraison estimée</div><div class="v">' + R.fmtDate(delivery) + '</div><div class="hintline" style="margin-top:2px">si tu scelles le cadre à la fin de la collecte</div></div></div>' +
        check +
        '<div class="hintline" style="margin-top:12px">Cette date est indiquée aux proches. La collecte se termine vraiment quand tu scelles le cadre : rien ne se ferme tout seul.</div>' +
        '<div class="stack" style="margin-top:20px"><button class="btn" id="next">Continuer <span class="arrow"></span></button></div>' +
      '</div></div>';
    document.getElementById('back').onclick = function () { go('infos'); };
    document.getElementById('fDeadline').onchange = function () { f.deadline = this.value; render(); };
    document.getElementById('useReco').onclick = function () { f.deadline = rec; render(); };
    document.getElementById('next').onclick = function () { go('recap'); };
  };

  /* ------------------------------------------------------------ récap */
  SC.recap = function () {
    var f = form();
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button>' + steps(2, 3) + '<span class="kicker">Presque prêt</span><h1>On récapitule</h1></div>' +
      '<div class="body"><div class="recap">' +
        '<div class="li"><span class="k">Pour</span><span class="v">' + esc(f.recipient_name) + (f.occasion ? ' · ' + esc(f.occasion) : '') + '</span></div>' +
        '<div class="li"><span class="k">De la part de</span><span class="v">' + esc(f.organizer_name) + '</span></div>' +
        (f.event_date ? '<div class="li"><span class="k">Événement</span><span class="v">' + R.fmtShort(f.event_date) + '</span></div>' : '') +
        '<div class="li"><span class="k">Fin de collecte</span><span class="v">' + R.fmtShort(f.deadline) + '</span></div>' +
        '<div class="li"><span class="k">Places</span><span class="v">' + D.project.capacity + ' proches</span></div>' +
      '</div><p class="error"></p>' +
      '<div class="stack" style="margin-top:18px"><button class="btn gold" id="launch" data-busy>' + (D.project.setupDone ? 'Enregistrer' : 'Lancer la collecte') + ' <span class="arrow"></span></button>' +
      '<div class="hintline" style="text-align:center">Ton lien à partager est débloqué juste après.</div></div></div></div>';
    document.getElementById('back').onclick = function () { go('cloture'); };
    document.getElementById('launch').onclick = function () {
      setBusy(true);
      api('POST', '/setup', { body: f }).then(function (d) { D = d; S.form = {}; setBusy(false); go('dashboard'); }).catch(fail);
    };
  };

  /* -------------------------------------------------------- tableau de bord */
  var STATUS = { preparing: 'En préparation', collecting: 'Collecte en cours', sealed: 'Scellé · en préparation', production: 'En fabrication', shipped: 'Expédié', done: 'Livré' };
  function shareMsg() {
    var p = pr();
    return 'Coucou ! On prépare une surprise pour ' + P() + ' ❤️\n\nÇa prend juste quelques minutes : ajoute un souvenir avec ' + p.lui + ' et laisse-' + p.lui + ' un petit mot, drôle, touchant, ou juste comme tu le sens.\n\nTu peux participer ici : ' + D.participationUrl;
  }
  SC.dashboard = function () {
    var pj = D.project;
    var collecting = pj.status === 'collecting';
    var chips = D.contributions.map(function (c) {
      return '<span class="pchip' + (c.hasPhoto ? '' : ' nophoto') + '" title="' + (c.hasPhoto ? '' : 'sans photo pour le cadre') + '"><span class="av"' + (c.selfie ? ' style="background-image:url(\'' + c.selfie + '\')"' : '') + '>' + (c.selfie ? '' : esc(c.name[0])) + '</span>' + esc(c.name) + (c.hasPhoto ? '' : ' ·🖼️') + '</span>';
    }).join('');
    var msg = shareMsg();
    var head;
    if (collecting) {
      head = '<h1 class="lede" style="text-align:center;font-size:24px;margin-top:12px">C’est parti !<br>Ton lien est prêt <span class="heart">♥</span></h1>' +
        '<div class="sub" style="margin-top:10px">Un petit mot tout prêt à envoyer aux proches de ' + esc(P()) + ' :</div>' +
        '<div class="msgcard">' + esc(msg) + '</div>' +
        '<div class="stack" style="margin-top:12px"><a class="btn wa" href="https://wa.me/?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener">✆  Partager sur WhatsApp</a><button class="btn line" id="copyMsg">Copier le message</button></div>' +
        '<div class="linkbox" style="margin-top:16px"><span class="u">' + esc(D.participationUrl.replace(/^https?:\/\//, '')) + '</span><button class="cp" id="copyLink">Copier le lien</button></div>' +
        (pj.deadline ? '<div class="center-x" style="margin-top:22px"><span class="chip">⏳ Clôture le ' + R.fmtShort(pj.deadline) + (pj.daysLeft != null ? ' · ' + pj.daysLeft + ' j' : '') + '</span></div>' : '');
    } else {
      head = '<h1 class="lede" style="text-align:center;font-size:24px;margin-top:12px">Le cadre de ' + esc(P()) + '</h1>' +
        '<div class="center-x" style="margin-top:12px"><span class="status-pill">' + esc(STATUS[pj.status] || pj.status) + '</span></div>' +
        '<div class="estimate" style="margin-top:16px"><div class="bx">📦</div><div><div class="k">' + (pj.status === 'shipped' ? 'Expédié le' : 'Livraison estimée') + '</div><div class="v">' + R.fmtDate(pj.status === 'shipped' && pj.shippedAt ? pj.shippedAt.slice(0, 10) : pj.estimatedDelivery) + '</div></div></div>' +
        (D.frameUrl ? '<div class="note"><span class="em">📱</span><span>Le cadre est prêt à être scanné. Les souvenirs se dévoilent au premier scan par ' + esc(P()) + '.</span></div>' : '');
    }
    app.innerHTML = '<div class="view fade"><div class="body" style="padding-top:52px">' +
      '<div class="brand" style="font-size:26px">Ravive</div>' + head +
      '<div class="dashcard"><div class="dashrow"><span>Déjà participé</span><b>' + pj.used + ' / ' + pj.capacity + ' proches</b></div>' +
        (chips ? '<div class="pchips">' + chips + '</div>' : '<div class="hintline">Personne pour l’instant. Partage le lien !</div>') +
        (D.contributions.some(function (c) { return !c.hasPhoto; }) ? '<div class="hintline" style="margin-top:8px">🖼️ = pas encore de photo pour le cadre</div>' : '') +
      '</div>' +
      (collecting && D.extraSeatsUrl && pj.used >= Math.floor(pj.capacity * 0.8) ? '<div class="note"><span class="em">✨</span><span>Presque complet ! <a href="' + esc(D.extraSeatsUrl) + '" style="color:var(--gold);font-weight:800">Ajouter des places</a>' + (D.extraSeatPriceCents ? ' (' + (D.extraSeatPriceCents / 100).toFixed(2).replace('.', ',') + ' € par proche)' : '') + '.</span></div>' : '') +
      '<div class="stack" style="margin-top:16px">' +
        (collecting ? '<button class="btn gold" id="compose">La collecte est terminée → composer le cadre</button><div class="hintline" style="text-align:center">Tu choisis la mise en page et les photos, puis tu scelles.</div>' : '') +
        '<a class="btn line" href="' + esc(D.previewUrl) + '" target="_blank" rel="noopener">👀  Voir ce que ' + esc(P()) + ' découvrira</a>' +
        (collecting ? '<button class="skip" id="edit">Modifier les informations</button>' : '') +
      '</div>' +
      '<div class="foot">Tableau de bord personnel · <a href="/acces">lien perdu ?</a></div>' +
      '</div></div>';
    var cm = document.getElementById('copyMsg'); if (cm) cm.onclick = function () { copy(msg, cm, 'Copié ✓'); };
    var cl = document.getElementById('copyLink'); if (cl) cl.onclick = function () { copy(D.participationUrl, cl, 'Copié ✓'); };
    var co = document.getElementById('compose'); if (co) co.onclick = function () { go('finalisation'); };
    var ed = document.getElementById('edit'); if (ed) ed.onclick = function () { S.form = {}; go('infos'); };
  };
  function copy(text, btn, label) {
    var done = function () { var old = btn.textContent; btn.textContent = label; setTimeout(function () { btn.textContent = old; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(function () { prompt('Copie ce texte :', text); });
    else prompt('Copie ce texte :', text);
  }

  /* ------------------------------------------------------- composition */
  function currentTemplate() { return D.templates.find(function (t) { return t.id === S.tpl; }) || null; }
  function initComposition() {
    if (S.compInit) return;
    S.compInit = true;
    S.tpl = D.project.templateId || null;
    S.frameText = D.project.frameText || '';
    S.sel = D.photos.filter(function (p) { return p.slot; }).sort(function (a, b) { return a.slot - b.slot; }).map(function (p) { return p.id; });
    if (!S.tpl) {
      // gabarit par défaut : le plus proche du nombre de photos disponibles
      var n = D.photos.length;
      var best = D.templates.slice().sort(function (a, b) { return Math.abs(a.slotCount - n) - Math.abs(b.slotCount - n); })[0];
      S.tpl = best ? best.id : null;
      if (S.tpl) scheduleSave(); // affiche tout de suite l'aperçu du gabarit vide
    }
  }
  var saveTimer = null;
  function saveComposition() {
    var t = currentTemplate();
    if (!t) return Promise.resolve();
    return api('PUT', '/composition', { body: { templateId: t.id, assignments: S.sel.slice(0, t.slotCount).map(function (id, i) { return { photoId: id, slot: i + 1 }; }), frameText: S.frameText } })
      .then(function () { loadPreview(); }).catch(function () {});
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveComposition, 400); }
  function loadPreview() {
    var box = document.getElementById('frame');
    if (!box) return;
    fetch('/api/o/' + D.token + '/preview.svg?ts=' + Date.now()).then(function (r) { return r.ok ? r.text() : ''; }).then(function (svg) {
      if (!svg) return;
      if (!box.id) box.id = 'svgbox' + (++svgSeq);
      svg = svg.replace(/<\?xml[^>]*>/, '').replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, function (m, attrs, css) {
        return '<style' + attrs + '>' + css.replace(/(^|\})\s*([^{}]+)\{/g, function (mm, pre, sel) { return pre + sel.split(',').map(function (x) { return '#' + box.id + ' ' + x.trim(); }).join(', ') + '{'; }) + '</style>';
      });
      box.innerHTML = svg;
      var s = box.querySelector('svg'); if (s) { s.removeAttribute('width'); s.removeAttribute('height'); }
    });
  }
  SC.finalisation = function () {
    initComposition();
    var t = currentTemplate();
    var need = t ? t.slotCount : 0;
    var chosen = S.sel.length;
    var gabs = D.templates.map(function (g) {
      return '<div class="gab' + (S.tpl === g.id ? ' on' : '') + '" data-t="' + g.id + '"><div class="gimg" style="background-image:url(\'' + g.svg + '\')"></div><div class="gt">' + esc(g.name.replace(/^Mosaïque /, '').replace(/^Cœur /, 'Cœur ')) + '</div><div class="gs">' + g.slotCount + ' photos</div></div>';
    }).join('');
    var pool = D.photos.map(function (p) {
      var i = S.sel.indexOf(p.id);
      return '<div class="pc' + (i >= 0 ? ' sel' : '') + '" data-p="' + p.id + '"><img src="' + p.thumb + '" alt="" loading="lazy"><div class="chk">' + (i >= 0 ? i + 1 : '✓') + '</div>' +
        (p.contributorName ? '<div class="who">' + esc(p.contributorName) + '</div>' : p.source === 'organizer' ? '<button class="rm" data-rm="' + p.id + '" title="Retirer">×</button>' : '') + '</div>';
    }).join('');
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button><span class="kicker">Collecte terminée · ' + D.project.used + ' proches</span><h1>Compose le cadre<br>de ' + esc(P()) + '</h1></div>' +
      '<div class="body">' +
        '<div class="product" style="margin-bottom:18px"><div class="frame" id="frame"></div><div class="hintline" style="text-align:center;margin-top:10px">Aperçu · ' + (t ? esc(t.name) : 'choisis une mise en page') + '</div></div>' +
        '<label style="font-weight:800;font-size:12.5px;display:block;margin-bottom:8px">Mise en page</label><div class="gabs" id="gabs">' + gabs + '</div>' +
        (t && t.hasText ? '<div class="field"><label>Ton petit mot sur le cadre</label><input class="inp" id="ftext" value="' + esc(S.frameText) + '" maxlength="80" placeholder="Ex. Joyeux anniversaire ' + esc(P()) + ' !"></div>' : '') +
        '<div class="selcount"><span class="t">Photos sur le cadre</span><span class="chip">' + chosen + ' / ' + need + '</span></div>' +
        '<div class="hintline" style="margin:-4px 0 12px">Touche pour ajouter ou retirer, dans l’ordre des emplacements. ' + (chosen < need ? 'Il en manque ' + (need - chosen) + ' : complète avec tes propres photos si besoin.' : chosen > need ? 'Retire-en ' + (chosen - need) + '.' : 'Le compte est bon !') + '</div>' +
        '<div class="poolgrid" id="pool">' + pool + '<div class="pc add" id="addPhotos">+</div></div>' +
        '<p class="error"></p>' +
        '<div class="stack" style="margin-top:22px"><button class="btn" id="validate" data-busy' + (chosen === need && need > 0 ? '' : ' disabled') + '>Valider la composition</button></div>' +
      '</div></div>';
    document.getElementById('back').onclick = function () { go('dashboard'); };
    document.getElementById('gabs').onclick = function (e) { var g = e.target.closest('.gab'); if (!g) return; S.tpl = Number(g.dataset.t); scheduleSave(); render(); };
    var ft = document.getElementById('ftext'); if (ft) ft.oninput = function () { S.frameText = this.value; scheduleSave(); };
    document.getElementById('pool').onclick = function (e) {
      var rm = e.target.closest('[data-rm]');
      if (rm) { e.stopPropagation(); removeOwnPhoto(Number(rm.dataset.rm)); return; }
      var c = e.target.closest('.pc[data-p]');
      if (!c) return;
      var id = Number(c.dataset.p), i = S.sel.indexOf(id);
      if (i >= 0) S.sel.splice(i, 1); else S.sel.push(id);
      scheduleSave(); render();
    };
    document.getElementById('addPhotos').onclick = function () { fpo.click(); };
    document.getElementById('validate').onclick = function () {
      setBusy(true);
      clearTimeout(saveTimer);
      saveComposition().then(function () { setBusy(false); go('sceller'); });
    };
    loadPreview();
  };
  fpo.onchange = function () {
    var files = Array.prototype.slice.call(fpo.files); fpo.value = '';
    if (!files.length) return;
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        return R.loadImage(f).then(function (l) { return R.shrink(l.img, 2000); }).then(function (s) {
          return api('POST', '/photos', { body: s.blob, headers: { 'Content-Type': 'image/jpeg' } });
        }).then(function (p) { D.photos.push(p); S.sel.push(p.id); });
      });
    });
    chain.then(function () { scheduleSave(); render(); }).catch(fail);
  };
  function removeOwnPhoto(id) {
    if (!confirm('Retirer cette photo ?')) return;
    api('DELETE', '/photos/' + id).then(function () {
      D.photos = D.photos.filter(function (p) { return p.id !== id; });
      S.sel = S.sel.filter(function (x) { return x !== id; });
      scheduleSave(); render();
    }).catch(fail);
  }

  /* -------------------------------------------------------- scellement */
  SC.sceller = function () {
    var t = currentTemplate();
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button><span class="kicker">Dernière étape</span><h1>Sceller le cadre</h1></div>' +
      '<div class="body"><div class="product"><div class="frame" id="frame"></div></div>' +
        '<div class="note"><span class="em">⚠️</span><span>Une fois scellé, le cadre part en fabrication et les proches ne peuvent plus rien ajouter.</span></div>' +
        '<div class="recap" style="margin-top:14px">' +
          '<div class="li"><span class="k">Photos</span><span class="v">' + S.sel.length + '</span></div>' +
          '<div class="li"><span class="k">Mise en page</span><span class="v">' + (t ? esc(t.name) : '—') + '</span></div>' +
          (S.frameText ? '<div class="li"><span class="k">Petit mot</span><span class="v">' + esc(S.frameText) + '</span></div>' : '') +
          '<div class="li"><span class="k">Proches</span><span class="v">' + D.project.used + '</span></div>' +
          '<div class="li"><span class="k">Livraison estimée</span><span class="v">' + R.fmtShort(R.addDays(R.todayISO(), D.project.fabricationDays || 7)) + '</span></div>' +
        '</div><p class="error"></p>' +
        '<div class="stack" style="margin-top:18px"><button class="btn gold" id="seal" data-busy>Sceller et lancer la fabrication</button></div>' +
      '</div></div>';
    document.getElementById('back').onclick = function () { go('finalisation'); };
    document.getElementById('seal').onclick = function () {
      if (!confirm('Sceller le cadre de ' + P() + ' ? Cette action est définitive : la collecte se ferme et la fabrication démarre.')) return;
      setBusy(true);
      api('POST', '/seal', { body: { confirm: true } }).then(function (d) { D = d; setBusy(false); go('fabrique'); }).catch(fail);
    };
    loadPreview();
  };
  SC.fabrique = function () {
    app.innerHTML = centered('📦', 'C’est scellé,<br>ton cadre part<br>en fabrication !',
      'Livraison estimée le ' + R.fmtShort(D.project.estimatedDelivery) + '. ' + esc(P()) + ' n’aura plus qu’à approcher son téléphone. <span class="heart">♥</span>',
      '<button class="btn line" id="dash">Voir mon tableau de bord</button>');
    document.getElementById('dash').onclick = function () { go('dashboard'); };
  };

  render();
})();
