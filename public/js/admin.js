'use strict';

/* ravive — administration : projets, cadres NFC, gabarits, questions, formules, réglages, cartes */

(function () {
  var token = sessionStorage.getItem('ravive_admin') || '';
  var STATUS_LABELS = {
    preparing: 'En préparation', collecting: 'Collecte en cours', sealed: 'Scellé',
    production: 'En fabrication', shipped: 'Expédié', done: 'Terminé',
  };
  var VISUAL_KEYS = [
    ['contributor_hero', 'Parcours contributeur : illustration d’accueil'],
    ['organizer_hero', 'Parcours organisateur : illustration d’accueil'],
    ['recipient_hero', 'Parcours destinataire : illustration d’accueil'],
    ['recipient_ready', 'Destinataire : cadre pas encore prêt'],
  ];

  var $ = function (id) { return document.getElementById(id); };
  var loginScreen = $('loginScreen');
  var dashScreen = $('dashScreen');
  var loginError = $('loginError');
  var cache = { formulas: [], templates: [] };
  var blobUrls = {};

  /* ---------------------------------------------------------------- utils */
  function api(method, path, body, opts) {
    opts = opts || {};
    var headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
    var payload;
    if (body instanceof Blob || body instanceof File) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    return fetch(path, { method: method, headers: headers, body: payload }).then(function (r) {
      if (r.status === 401) throw new Error('unauthorized');
      if (opts.raw) return r;
      return r.json().then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'http_' + r.status); e.body = j; throw e; }
        return j;
      });
    });
  }

  // Média protégé → URL blob (mise en cache par URL)
  function authUrl(path) {
    if (blobUrls[path]) return Promise.resolve(blobUrls[path]);
    return api('GET', path, undefined, { raw: true }).then(function (r) {
      if (!r.ok) throw new Error('media');
      return r.blob();
    }).then(function (b) { blobUrls[path] = URL.createObjectURL(b); return blobUrls[path]; });
  }
  function authImg(img, path) {
    authUrl(path).then(function (u) { img.src = u; }).catch(function () { img.alt = '×'; });
  }
  var svgSeq = 0;
  function authSvg(box, path) {
    api('GET', path, undefined, { raw: true }).then(function (r) { return r.text(); }).then(function (svg) {
      // Les <style> d'un SVG inséré dans la page s'appliquent à toute la page :
      // on préfixe chaque sélecteur par l'id du conteneur pour les cloisonner.
      if (!box.id) box.id = 'svgbox' + (++svgSeq);
      svg = svg.replace(/<\?xml[^>]*>/, '').replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, function (m, attrs, css) {
        return '<style' + attrs + '>' + css.replace(/(^|\})\s*([^{}]+)\{/g, function (mm, pre, sel) {
          return pre + sel.split(',').map(function (x) { return '#' + box.id + ' ' + x.trim(); }).join(', ') + '{';
        }) + '</style>';
      });
      box.innerHTML = svg;
      var s = box.querySelector('svg');
      if (s) { s.removeAttribute('width'); s.removeAttribute('height'); }
      // Les images de l'aperçu pointent vers l'API admin protégée : on les charge en blob
      Array.prototype.forEach.call(box.querySelectorAll('image'), function (im) {
        var href = im.getAttribute('href') || im.getAttribute('xlink:href');
        if (href && href.indexOf('/api/admin/') === 0) authUrl(href).then(function (u) { im.setAttribute('href', u); });
      });
    });
  }
  function download(path, filename) {
    return api('GET', path, undefined, { raw: true }).then(function (r) { return r.blob(); }).then(function (b) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = filename;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
  }
  function fmtDate(s) { return s ? s.replace('T', ' ').slice(0, 16) : '—'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function tag(status) { return '<span class="tag ' + esc(status) + '">' + esc(STATUS_LABELS[status] || status) + '</span>'; }
  function toast(msg, err) {
    var t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, err ? 4000 : 2200);
  }
  function fail(err) { toast(err && err.message === 'unauthorized' ? 'Session expirée, reconnectez-vous.' : 'Erreur : ' + (err && err.message || 'inconnue'), true); }
  function copy(text) { navigator.clipboard && navigator.clipboard.writeText(text).then(function () { toast('Copié'); }); }

  /* ----------------------------------------------------------- navigation */
  var currentTab = null;
  function showTab(name, arg) {
    currentTab = name;
    Array.prototype.forEach.call(document.querySelectorAll('#nav button[data-tab]'), function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
    var loaders = { overview: loadOverview, projects: loadProjects, frames: loadFrames, templates: loadTemplates, questions: loadQuestions, formulas: loadFormulas, settings: loadSettings, cards: loadCards };
    if (name === 'projects' && arg) openProject(arg); else if (name === 'projects') { $('projectDetail').classList.add('hidden'); $('projectsList').classList.remove('hidden'); }
    if (loaders[name]) loaders[name]().catch(fail);
    window.scrollTo(0, 0);
  }
  function route() {
    var h = location.hash.replace('#', '').split('/');
    showTab(h[0] || 'overview', h[1]);
  }
  $('nav').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) location.hash = b.dataset.tab;
  });
  window.addEventListener('hashchange', function () { if (dashScreen.classList.contains('active')) route(); });

  /* ----------------------------------------------------------- connexion */
  function showDash() {
    loginScreen.classList.remove('active');
    dashScreen.classList.add('active');
    route();
  }
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    loginError.classList.remove('show');
    token = $('user').value + ':' + $('pass').value;
    api('GET', '/api/admin/overview').then(function () {
      sessionStorage.setItem('ravive_admin', token);
      showDash();
    }).catch(function (err) {
      token = '';
      loginError.textContent = err.message === 'unauthorized' ? 'Identifiant ou mot de passe incorrect.' : 'Erreur de connexion au serveur.';
      loginError.classList.add('show');
    });
  });
  $('logoutBtn').addEventListener('click', function () {
    token = '';
    sessionStorage.removeItem('ravive_admin');
    location.hash = '';
    dashScreen.classList.remove('active');
    loginScreen.classList.add('active');
  });
  if (token) api('GET', '/api/admin/overview').then(showDash).catch(function () { token = ''; sessionStorage.removeItem('ravive_admin'); });

  /* ------------------------------------------------------ vue d'ensemble */
  function loadOverview() {
    return api('GET', '/api/admin/overview').then(function (d) {
      var s = d.stats;
      $('overviewStats').innerHTML = Object.keys(STATUS_LABELS).map(function (k) {
        return '<div class="stat" data-status="' + k + '"><b>' + s[k] + '</b><span>' + esc(STATUS_LABELS[k]) + '</span></div>';
      }).join('') + '<div class="stat" data-status=""><b>' + s.total + '</b><span>projets au total</span></div>';
      $('systemStats').innerHTML =
        '<div class="stat"><b>' + d.templates + '</b><span>gabarits</span></div>' +
        '<div class="stat"><b>' + d.questions + '</b><span>questions actives</span></div>' +
        '<div class="stat' + (d.unlinkedFrames === 0 ? ' warn' : '') + '"><b>' + d.unlinkedFrames + '</b><span>cadres NFC disponibles</span></div>' +
        '<div class="stat' + (d.mail === 'brevo' ? '' : ' warn') + '"><b>' + (d.mail === 'brevo' ? 'Brevo' : 'console') + '</b><span>envoi des emails</span></div>' +
        '<div class="stat' + (d.shopifyWebhook ? '' : ' warn') + '"><b>' + (d.shopifyWebhook ? 'ok' : 'à configurer') + '</b><span>webhook Shopify</span></div>' +
        '<div class="stat"><b>' + (d.ffmpeg ? 'oui' : 'non') + '</b><span>compression audio (ffmpeg)</span></div>';
    });
  }
  $('overviewStats').addEventListener('click', function (e) {
    var st = e.target.closest('.stat');
    if (!st) return;
    $('projectStatus').value = st.dataset.status || '';
    location.hash = 'projects';
  });

  /* -------------------------------------------------------------- projets */
  function loadProjects() {
    var q = $('projectSearch').value.trim();
    var status = $('projectStatus').value;
    return api('GET', '/api/admin/projects?q=' + encodeURIComponent(q) + '&status=' + encodeURIComponent(status)).then(function (d) {
      var body = $('projectsBody');
      body.innerHTML = d.projects.length ? '' : '<tr><td colspan="10" class="muted">Aucun projet.</td></tr>';
      d.projects.forEach(function (p) {
        var tr = document.createElement('tr');
        tr.className = 'click';
        tr.innerHTML =
          '<td><b>' + esc(p.recipient_name || '(à créer)') + '</b><br><span class="mono muted">' + esc(p.slug) + '</span></td>' +
          '<td>' + esc(p.organizer_name || '') + '<br><span class="small muted">' + esc(p.organizer_email) + '</span></td>' +
          '<td class="small">' + esc(p.formula_name || '—') + '</td>' +
          '<td>' + tag(p.status) + '</td>' +
          '<td class="nowrap">' + p.contributions_count + ' / ' + p.capacity + '</td>' +
          '<td>' + p.photos_count + '</td>' +
          '<td class="small">' + (p.template_name ? esc(p.template_name) : '—') + '</td>' +
          '<td class="mono">' + (p.frame_slug ? esc(p.frame_slug) : '<span class="muted">—</span>') + '</td>' +
          '<td class="small">' + esc(p.shopify_order_number || '—') + '</td>' +
          '<td class="small nowrap">' + fmtDate(p.created_at) + '</td>';
        tr.addEventListener('click', function () { location.hash = 'projects/' + p.id; });
        body.appendChild(tr);
      });
    });
  }
  var searchTimer;
  $('projectSearch').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(function () { loadProjects().catch(fail); }, 250); });
  $('projectStatus').addEventListener('change', function () { loadProjects().catch(fail); });

  // Projet manuel
  $('newProjectBtn').addEventListener('click', function () {
    $('newProjectForm').classList.toggle('hidden');
    loadFormulas(true).then(function () {
      $('npFormula').innerHTML = '<option value="">—</option>' + cache.formulas.filter(function (f) { return f.active; }).map(function (f) {
        return '<option value="' + f.id + '">' + esc(f.name) + ' (' + f.max_contributors + ')</option>';
      }).join('');
    });
  });
  $('npCancel').addEventListener('click', function () { $('newProjectForm').classList.add('hidden'); });
  $('npCreate').addEventListener('click', function () {
    api('POST', '/api/admin/projects', {
      organizer_email: $('npEmail').value, organizer_name: $('npOrganizer').value, recipient_name: $('npRecipient').value,
      formula_id: $('npFormula').value || null, capacity: $('npCapacity').value || null, order_number: $('npOrder').value, send_email: $('npSend').checked,
    }).then(function (p) {
      var box = $('npResult');
      box.classList.remove('hidden');
      box.innerHTML = '<span>Lien organisateur :</span><code>' + esc(p.organizerUrl) + '</code><button class="btn inline small ghost">Copier</button>';
      box.querySelector('button').addEventListener('click', function () { copy(p.organizerUrl); });
      toast('Projet créé');
      loadProjects();
    }).catch(function (err) { toast(err.message === 'invalid_email' ? 'Email invalide' : 'Création impossible : ' + err.message, true); });
  });

  // Fiche projet
  function openProject(id) {
    $('projectsList').classList.add('hidden');
    var box = $('projectDetail');
    box.classList.remove('hidden');
    box.innerHTML = '<p class="muted">Chargement…</p>';
    return api('GET', '/api/admin/projects/' + id).then(function (p) { renderProject(p); }).catch(function (err) {
      box.innerHTML = '<p class="error show">Projet introuvable.</p>';
      fail(err);
    });
  }

  function renderProject(p) {
    var box = $('projectDetail');
    var tpl = p.template;
    var html = '' +
      '<div class="actions"><button class="btn inline ghost" id="pdBack">← Tous les projets</button></div>' +
      '<div class="detail-head"><div>' +
        '<h1>' + esc(p.recipient_name || 'Projet à créer') + ' <span class="muted" style="font-size:0.9rem">' + esc(p.occasion || '') + '</span></h1>' +
        '<div class="meta">' +
          'Code <b class="mono">' + esc(p.slug) + '</b> · ' + tag(p.status) + ' · <b>' + p.used + '</b> / ' + p.capacity + ' proches · ' + p.photos.filter(function (x) { return !x.deletedAt; }).length + ' photos<br>' +
          'Organisateur : <b>' + esc(p.organizer_name || '') + '</b> ' + esc(p.organizer_email) + (p.event_date ? ' · Événement le <b>' + esc(p.event_date) + '</b>' : '') + '<br>' +
          'Commande ' + esc(p.shopify_order_number || '—') + ' · Formule ' + esc(p.formula ? p.formula.name : '—') + ' · Créé le ' + fmtDate(p.created_at) +
          (p.sealed_at ? ' · Scellé le ' + fmtDate(p.sealed_at) : '') + (p.shipped_at ? ' · Expédié le ' + fmtDate(p.shipped_at) : '') +
          (p.reveal_seen_at ? ' · Reveal vu le ' + fmtDate(p.reveal_seen_at) : ' · Reveal pas encore vu') +
        '</div></div>' +
        '<div><label class="small muted">Statut<br><select id="pdStatus">' + Object.keys(STATUS_LABELS).map(function (k) {
          return '<option value="' + k + '"' + (k === p.status ? ' selected' : '') + '>' + esc(STATUS_LABELS[k]) + '</option>';
        }).join('') + '</select></label> <button class="btn inline small" id="pdStatusSave">Changer</button></div>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="btn inline ghost" id="pdExport">Télécharger le ZIP du projet</button>' +
        '<a class="btn inline ghost" href="' + esc(p.previewUrl) + '" target="_blank" rel="noopener">Aperçu destinataire</a>' +
        '<button class="btn inline ghost" id="pdResend">Renvoyer un lien d’accès</button>' +
        '<button class="btn inline ghost" id="pdReset">Réinitialiser le reveal</button>' +
      '</div>' +
      '<div class="linkbox"><span>Lien de participation :</span><code>' + esc(p.participationUrl) + '</code><button class="btn inline small ghost" data-copy="' + esc(p.participationUrl) + '">Copier</button></div>' +

      '<h2>Cadre NFC</h2>' +
      (p.frame
        ? '<div class="linkbox"><span>Cadre associé :</span><code>' + esc(p.frame.url) + '</code><button class="btn inline small ghost" data-copy="' + esc(p.frame.url) + '">Copier</button><button class="btn inline small ghost danger" id="pdUnlink">Dissocier</button></div>'
        : '<div class="toolbar"><input type="text" id="pdFrameSlug" placeholder="Collez l’URL du cadre (…/f/xxxxxxxxxx) ou choisissez ci-dessous" style="flex:1;min-width:260px"><select id="pdFrameSelect"><option value="">Cadres disponibles…</option></select><button class="btn inline" id="pdLink">Associer</button></div>') +

      '<h2>Informations</h2>' +
      '<div class="form">' +
        '<label>Prénom destinataire<input type="text" id="pdRecipient" value="' + esc(p.recipient_name) + '"></label>' +
        '<label>Nom du projet<input type="text" id="pdName" value="' + esc(p.project_name) + '"></label>' +
        '<label>Occasion<input type="text" id="pdOccasion" value="' + esc(p.occasion) + '"></label>' +
        '<label>Date de l’événement<input type="date" id="pdDate" value="' + esc(p.event_date) + '"></label>' +
        '<label>Prénom organisateur<input type="text" id="pdOrganizer" value="' + esc(p.organizer_name) + '"></label>' +
        '<label>Email organisateur<input type="email" id="pdEmail" value="' + esc(p.organizer_email) + '"></label>' +
        '<label>Capacité (proches)<input type="number" id="pdCapacity" min="1" max="1000" value="' + p.capacity + '"></label>' +
        '<label>Petit mot du cadre<input type="text" id="pdFrameText" value="' + esc(p.frame_text) + '"></label>' +
        '<label class="wide">Notes internes<textarea id="pdNotes">' + esc(p.admin_notes) + '</textarea></label>' +
      '</div>' +
      '<div class="actions"><button class="btn inline" id="pdSave">Enregistrer</button></div>' +

      '<h2>Composition' + (tpl ? ' · ' + esc(tpl.name) + ' (' + p.photos.filter(function (x) { return x.slot; }).length + '/' + tpl.slotCount + ')' : '') + '</h2>' +
      (tpl ? '<div class="preview-box" id="pdPreview"></div>' : '<p class="note">L’organisateur n’a pas encore choisi de gabarit.</p>') +

      '<h2>Photos (' + p.photos.length + ')</h2>' +
      '<div class="toolbar"><input type="file" id="pdPhotoFile" accept="image/*" multiple><button class="btn inline ghost" id="pdPhotoAdd">Ajouter</button><input type="file" id="pdReplaceFile" accept="image/*" class="hidden"></div>' +
      '<div class="photos" id="pdPhotos"></div>' +

      '<h2>Contributions (' + p.contributions.filter(function (c) { return c.status === 'done' && !c.deletedAt; }).length + ')</h2>' +
      '<div id="pdContribs"></div>' +

      '<h2>Emails envoyés</h2>' +
      '<div class="tablewrap"><table><thead><tr><th>Date</th><th>Type</th><th>Destinataire</th><th>Sujet</th><th>Statut</th></tr></thead><tbody>' +
        (p.emails.length ? p.emails.map(function (e) {
          return '<tr><td class="nowrap small">' + fmtDate(e.created_at) + '</td><td class="small">' + esc(e.type) + '</td><td class="small">' + esc(e.to_email) + '</td><td class="small">' + esc(e.subject) + '</td><td><span class="tag ' + (e.status === 'sent' ? 'done' : e.status === 'failed' ? 'sealed' : 'off') + '">' + esc(e.status) + (e.error ? ' · ' + esc(e.error) : '') + '</span></td></tr>';
        }).join('') : '<tr><td colspan="5" class="muted">Aucun email.</td></tr>') +
      '</tbody></table></div>';
    box.innerHTML = html;

    // Photos
    var grid = $('pdPhotos');
    p.photos.forEach(function (ph) {
      var d = document.createElement('div');
      d.className = 'photo' + (ph.deletedAt ? ' deleted' : '');
      d.innerHTML = '<img alt="">' + (ph.slot ? '<span class="slot">' + ph.slot + '</span>' : '') +
        '<div class="tools">' + (ph.deletedAt ? '' : '<button title="Remplacer" data-replace="' + ph.id + '">⇄</button><button title="Supprimer" data-del="' + ph.id + '">×</button>') + '</div>' +
        '<div class="who">' + esc(ph.contributorName || (ph.source === 'organizer' ? 'organisateur' : 'admin')) + (ph.deletedAt ? ' (masquée)' : '') + '</div>';
      authImg(d.querySelector('img'), ph.thumb);
      d.querySelector('img').addEventListener('click', function () { authUrl(ph.original).then(function (u) { window.open(u, '_blank'); }); });
      grid.appendChild(d);
    });

    // Contributions et leurs souvenirs
    var cbox = $('pdContribs');
    if (!p.contributions.length) cbox.innerHTML = '<p class="note">Aucune contribution pour l’instant.</p>';
    var REL = { ami: 'ami·e', famille: 'famille', amour: 'en couple', collegue: 'collègue', autre: 'autre' };
    p.contributions.forEach(function (c) {
      var d = document.createElement('div');
      d.className = 'contrib' + (c.deletedAt ? ' deleted' : '');
      var mems = c.memories.map(function (m) {
        var icon = m.kind === 'voice' ? '🎙️' : m.kind === 'text' ? '✍️' : '📸';
        return '<div class="mem' + (m.deletedAt ? ' deleted' : '') + '" data-mid="' + m.id + '">' +
          '<div class="q">' + icon + ' ' + (m.free ? 'Mot libre' : esc(m.question || '')) + (c.star === m.id ? ' <span class="tag done">★ vu en premier</span>' : '') + (m.deletedAt ? ' <span class="tag sealed">masqué</span>' : '') + '</div>' +
          (m.text ? '<div class="txt">' + esc(m.text) + '</div>' : '') +
          (m.audio ? '<audio controls preload="none" data-src="' + esc(m.audio) + '"></audio>' + (m.duration ? '<span class="small muted"> ' + Math.round(m.duration) + ' s</span>' : '') : '') +
          (m.photo ? '<div class="photo" style="width:120px;margin-top:6px"><img alt="" data-photo="' + esc(m.photo) + '"></div>' : '') +
          '<div class="actions">' + (m.deletedAt
            ? '<button class="btn inline small ghost" data-mrestore="' + m.id + '">Restaurer ce souvenir</button>'
            : '<button class="btn inline small ghost danger" data-mhide="' + m.id + '">Masquer ce souvenir</button>') + '</div></div>';
      }).join('');
      d.innerHTML = '<img alt="">' +
        '<div class="body"><b>' + esc(c.name) + '</b> <span class="small muted">· ' + (REL[c.relation] || 'lien non précisé') + ' · ' + c.memories.length + ' souvenir(s)' +
        (c.status !== 'done' ? ' · <span class="tag off">brouillon</span>' : '') + (c.deletedAt ? ' · <span class="tag sealed">masquée</span>' : '') + ' · ' + fmtDate(c.completedAt || c.createdAt) + '</span>' +
        (c.thumb ? '' : '<div class="small muted">Pas de photo pour le cadre</div>') +
        mems +
        '<div class="actions">' + (c.deletedAt
          ? '<button class="btn inline small ghost" data-restore="' + c.id + '">Restaurer</button>'
          : (c.status === 'done' ? '<button class="btn inline small ghost danger" data-hide="' + c.id + '">Masquer toute la contribution</button>' : '')) + '</div></div>';
      var av = d.querySelector('img');
      if (c.selfie) authImg(av, c.selfie); else if (c.thumb) authImg(av, c.thumb); else av.remove();
      Array.prototype.forEach.call(d.querySelectorAll('audio'), function (au) {
        au.addEventListener('play', function () { if (!au.dataset.loaded) { au.dataset.loaded = '1'; authUrl(au.dataset.src).then(function (u) { au.src = u; au.play(); }); } }, { once: true });
      });
      Array.prototype.forEach.call(d.querySelectorAll('img[data-photo]'), function (im) { authImg(im, im.dataset.photo); });
      cbox.appendChild(d);
    });

    if (tpl) authSvg($('pdPreview'), '/api/admin/projects/' + p.id + '/preview.svg');

    // Cadres disponibles
    var sel = $('pdFrameSelect');
    if (sel) api('GET', '/api/admin/frames?unlinked=1').then(function (d) {
      d.frames.forEach(function (f) { var o = document.createElement('option'); o.value = f.slug; o.textContent = f.slug + (f.label ? ' · ' + f.label : ''); sel.appendChild(o); });
    });

    // Actions
    var reload = function () { return openProject(p.id); };
    var act = function (promise, msg) { return promise.then(function () { if (msg) toast(msg); return reload(); }).catch(fail); };
    $('pdBack').addEventListener('click', function () { location.hash = 'projects'; });
    box.addEventListener('click', function (e) {
      var t = e.target;
      if (t.dataset.copy) copy(t.dataset.copy);
      else if (t.dataset.del) { if (confirm('Masquer cette photo ? Elle disparaît du cadre et de la bibliothèque.')) act(api('DELETE', '/api/admin/projects/' + p.id + '/photos/' + t.dataset.del), 'Photo masquée'); }
      else if (t.dataset.replace) { var rf = $('pdReplaceFile'); rf.dataset.photo = t.dataset.replace; rf.click(); }
      else if (t.dataset.hide) { if (confirm('Masquer la contribution de ' + t.closest('.contrib').querySelector('b').textContent + ' ?')) act(api('DELETE', '/api/admin/projects/' + p.id + '/contributions/' + t.dataset.hide), 'Contribution masquée'); }
      else if (t.dataset.restore) act(api('POST', '/api/admin/projects/' + p.id + '/contributions/' + t.dataset.restore + '/restore'), 'Contribution restaurée');
      else if (t.dataset.mhide) act(api('DELETE', '/api/admin/projects/' + p.id + '/memories/' + t.dataset.mhide), 'Souvenir masqué');
      else if (t.dataset.mrestore) act(api('POST', '/api/admin/projects/' + p.id + '/memories/' + t.dataset.mrestore + '/restore'), 'Souvenir restauré');
    });
    $('pdReplaceFile').addEventListener('change', function () {
      var f = this.files[0], id = this.dataset.photo;
      if (!f) return;
      act(api('POST', '/api/admin/projects/' + p.id + '/photos/' + id + '/replace', f, { headers: { 'Content-Type': f.type || 'image/jpeg' } }), 'Photo remplacée');
    });
    $('pdPhotoAdd').addEventListener('click', function () {
      var files = Array.prototype.slice.call($('pdPhotoFile').files);
      if (!files.length) return toast('Choisissez d’abord des fichiers', true);
      var chain = Promise.resolve();
      files.forEach(function (f) { chain = chain.then(function () { return api('POST', '/api/admin/projects/' + p.id + '/photos', f, { headers: { 'Content-Type': f.type || 'image/jpeg' } }); }); });
      act(chain, files.length + ' photo(s) ajoutée(s)');
    });
    $('pdStatusSave').addEventListener('click', function () {
      var s = $('pdStatus').value;
      var notify = s === 'shipped' ? confirm('Envoyer l’email de confirmation d’expédition à l’organisateur ?') : false;
      act(api('POST', '/api/admin/projects/' + p.id + '/status', { status: s, notify: notify }), 'Statut mis à jour');
    });
    $('pdSave').addEventListener('click', function () {
      act(api('PATCH', '/api/admin/projects/' + p.id, {
        recipient_name: $('pdRecipient').value, project_name: $('pdName').value, occasion: $('pdOccasion').value, event_date: $('pdDate').value,
        organizer_name: $('pdOrganizer').value, organizer_email: $('pdEmail').value, capacity: $('pdCapacity').value, frame_text: $('pdFrameText').value, admin_notes: $('pdNotes').value,
      }), 'Enregistré');
    });
    $('pdExport').addEventListener('click', function () {
      toast('Préparation du ZIP…');
      download('/api/admin/projects/' + p.id + '/export.zip', 'ravive_' + p.slug + '.zip').catch(fail);
    });
    $('pdResend').addEventListener('click', function () {
      if (!confirm('Envoyer un nouveau lien à ' + p.organizer_email + ' ? L’ancien lien cessera de fonctionner.')) return;
      api('POST', '/api/admin/projects/' + p.id + '/resend-access').then(function (r) {
        toast(r.ok ? 'Email envoyé' : 'Email non envoyé (voir configuration), lien : ' + r.organizerUrl, !r.ok);
        copy(r.organizerUrl);
        reload();
      }).catch(fail);
    });
    $('pdReset').addEventListener('click', function () {
      if (confirm('Le prochain scan du cadre relancera le reveal comme un premier accès. Continuer ?')) act(api('POST', '/api/admin/projects/' + p.id + '/reset-reveal'), 'Reveal réinitialisé');
    });
    if ($('pdLink')) $('pdLink').addEventListener('click', function () {
      var slug = $('pdFrameSlug').value.trim() || $('pdFrameSelect').value;
      if (!slug) return toast('Indiquez un cadre', true);
      act(api('POST', '/api/admin/projects/' + p.id + '/frame', { slug: slug }), 'Cadre associé');
    });
    if ($('pdUnlink')) $('pdUnlink').addEventListener('click', function () {
      if (confirm('Dissocier ce cadre du projet ?')) act(api('DELETE', '/api/admin/projects/' + p.id + '/frame'), 'Cadre dissocié');
    });
  }

  /* ------------------------------------------------------------ cadres NFC */
  var lastFrames = null;
  function loadFrames() {
    return api('GET', '/api/admin/frames' + ($('frameUnlinked').checked ? '?unlinked=1' : '')).then(function (d) {
      var body = $('framesBody');
      body.innerHTML = d.frames.length ? '' : '<tr><td colspan="5" class="muted">Aucun cadre.</td></tr>';
      d.frames.forEach(function (f) {
        var url = d.baseUrl + '/f/' + f.slug;
        var tr = document.createElement('tr');
        tr.innerHTML = '<td class="mono"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a></td><td class="small">' + esc(f.label || '') + '</td>' +
          '<td>' + (f.project_id ? '<a href="#projects/' + f.project_id + '">' + esc(f.recipient_name || f.project_slug) + '</a>' : '<span class="muted">—</span>') + '</td>' +
          '<td class="small nowrap">' + fmtDate(f.created_at) + '</td><td class="small nowrap">' + fmtDate(f.linked_at) + '</td>';
        body.appendChild(tr);
      });
    });
  }
  $('frameUnlinked').addEventListener('change', function () { loadFrames().catch(fail); });
  $('frameGenerate').addEventListener('click', function () {
    var count = Number($('frameCount').value);
    if (!count || count < 1 || count > 1000) return;
    api('POST', '/api/admin/frames', { count: count, label: $('frameLabel').value }).then(function (d) {
      lastFrames = d.frames;
      $('frameCsv').classList.remove('hidden');
      toast(count + ' URL générées');
      return loadFrames();
    }).catch(fail);
  });
  $('frameCsv').addEventListener('click', function () {
    if (!lastFrames) return;
    var csv = 'url_nfc\n' + lastFrames.map(function (f) { return f.url; }).join('\n') + '\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'cadres-ravive-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  });

  /* -------------------------------------------------------------- gabarits */
  function loadTemplates() {
    return api('GET', '/api/admin/templates').then(function (d) {
      cache.templates = d.templates;
      var grid = $('templatesGrid');
      grid.innerHTML = d.templates.length ? '' : '<p class="note">Aucun gabarit. Importez vos fichiers SVG ci-dessus.</p>';
      d.templates.forEach(function (t) {
        var c = document.createElement('div');
        c.className = 'card';
        c.innerHTML = '<div class="svgbox"></div>' +
          '<div class="row"><input type="text" value="' + esc(t.name) + '" style="flex:1" data-name></div>' +
          '<div class="row small muted">' + t.slot_count + ' emplacements' + (t.has_text ? ' · petit mot' : '') + ' · ' + t.width_mm + '×' + t.height_mm + ' mm · <span class="mono">' + esc(t.key) + '</span></div>' +
          '<div class="row"><label class="small"><input type="checkbox" data-active' + (t.active ? ' checked' : '') + '> Proposé aux organisateurs</label>' +
          '<input type="number" data-order value="' + t.sort_order + '" style="width:70px" title="Ordre"></div>' +
          '<div class="row"><button class="btn inline small" data-save>Enregistrer</button><button class="btn inline small ghost danger" data-del>Supprimer</button></div>';
        authSvg(c.querySelector('.svgbox'), '/api/admin/templates/' + t.id + '.svg');
        c.querySelector('[data-save]').addEventListener('click', function () {
          api('PATCH', '/api/admin/templates/' + t.id, { name: c.querySelector('[data-name]').value, active: c.querySelector('[data-active]').checked, sort_order: c.querySelector('[data-order]').value })
            .then(function () { toast('Gabarit enregistré'); }).catch(fail);
        });
        c.querySelector('[data-del]').addEventListener('click', function () {
          if (!confirm('Supprimer le gabarit « ' + t.name + ' » ? S’il est utilisé par un projet, il sera seulement désactivé.')) return;
          api('DELETE', '/api/admin/templates/' + t.id).then(function () { toast('Gabarit supprimé'); return loadTemplates(); }).catch(fail);
        });
        grid.appendChild(c);
      });
    });
  }
  $('templateUpload').addEventListener('click', function () {
    var files = Array.prototype.slice.call($('templateFile').files);
    var errBox = $('templateError');
    errBox.classList.remove('show');
    if (!files.length) return toast('Choisissez un ou plusieurs fichiers SVG', true);
    var errors = [];
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        return api('POST', '/api/admin/templates', f, { headers: { 'Content-Type': 'image/svg+xml', 'X-Filename': encodeURIComponent(f.name) } })
          .then(function (r) { if (r.warnings.length) errors.push(f.name + ' : ' + r.warnings.slice(0, 2).join(' ; ') + (r.warnings.length > 2 ? '…' : '')); })
          .catch(function (err) { errors.push(f.name + ' : ' + err.message); });
      });
    });
    chain.then(function () {
      if (errors.length) { errBox.innerHTML = errors.map(esc).join('<br>'); errBox.classList.add('show'); }
      toast(files.length + ' fichier(s) traité(s)');
      $('templateFile').value = '';
      return loadTemplates();
    }).catch(fail);
  });

  /* ------------------------------------------------------------- questions */
  function loadQuestions() {
    return api('GET', '/api/admin/questions').then(function (d) {
      var body = $('questionsBody');
      body.innerHTML = '';
      d.questions.forEach(function (q) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td><input type="text" value="' + esc(q.text) + '" style="width:100%" data-text></td>' +
          '<td><select data-cat>' + ['', 'dire', 'souv', 'dossier', 'nous', 'devant'].map(function (k) { return '<option value="' + k + '"' + (q.category === k ? ' selected' : '') + '>' + (k || '—') + '</option>'; }).join('') + '</select></td>' +
          '<td><input type="number" value="' + q.sort_order + '" style="width:70px" data-order></td>' +
          '<td><input type="checkbox" data-active' + (q.active ? ' checked' : '') + '></td>' +
          '<td class="nowrap"><button class="btn inline small" data-save>OK</button> <button class="btn inline small ghost danger" data-del>×</button></td>';
        tr.querySelector('[data-save]').addEventListener('click', function () {
          api('PATCH', '/api/admin/questions/' + q.id, { text: tr.querySelector('[data-text]').value, category: tr.querySelector('[data-cat]').value, sort_order: tr.querySelector('[data-order]').value, active: tr.querySelector('[data-active]').checked })
            .then(function () { toast('Question enregistrée'); return loadQuestions(); }).catch(fail);
        });
        tr.querySelector('[data-del]').addEventListener('click', function () {
          if (confirm('Supprimer cette question ?')) api('DELETE', '/api/admin/questions/' + q.id).then(loadQuestions).catch(fail);
        });
        body.appendChild(tr);
      });
    });
  }
  $('questionAdd').addEventListener('click', function () {
    var text = $('questionNew').value.trim();
    if (!text) return;
    api('POST', '/api/admin/questions', { text: text, category: $('questionCat').value, sort_order: 99 }).then(function () { $('questionNew').value = ''; toast('Question ajoutée'); return loadQuestions(); }).catch(fail);
  });

  /* -------------------------------------------------------------- formules */
  function loadFormulas(quiet) {
    return api('GET', '/api/admin/formulas').then(function (d) {
      cache.formulas = d.formulas;
      if (quiet) return;
      var body = $('formulasBody');
      body.innerHTML = '';
      d.formulas.forEach(function (f) { body.appendChild(formulaRow(f)); });
    });
  }
  function formulaRow(f) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="text" value="' + esc(f.name) + '" data-name style="min-width:160px"></td>' +
      '<td><input type="number" value="' + f.max_contributors + '" data-max style="width:80px"></td>' +
      '<td><input type="number" step="0.01" value="' + (f.price_cents / 100).toFixed(2) + '" data-price style="width:90px"></td>' +
      '<td><input type="text" value="' + esc(f.shopify_variant_id) + '" data-variant style="width:150px"></td>' +
      '<td><input type="text" value="' + esc(f.shopify_sku) + '" data-sku style="width:120px"></td>' +
      '<td><input type="number" value="' + (f.sort_order || 0) + '" data-order style="width:60px"></td>' +
      '<td><input type="checkbox" data-active' + (f.active ? ' checked' : '') + '></td>' +
      '<td class="nowrap"><button class="btn inline small" data-save>OK</button> ' + (f.id ? '<button class="btn inline small ghost danger" data-del>×</button>' : '') + '</td>';
    tr.querySelector('[data-save]').addEventListener('click', function () {
      var body = {
        name: tr.querySelector('[data-name]').value, max_contributors: tr.querySelector('[data-max]').value,
        price_cents: Math.round(parseFloat(tr.querySelector('[data-price]').value || '0') * 100),
        shopify_variant_id: tr.querySelector('[data-variant]').value, shopify_sku: tr.querySelector('[data-sku]').value,
        sort_order: tr.querySelector('[data-order]').value, active: tr.querySelector('[data-active]').checked,
      };
      (f.id ? api('PATCH', '/api/admin/formulas/' + f.id, body) : api('POST', '/api/admin/formulas', body))
        .then(function () { toast('Formule enregistrée'); return loadFormulas(); }).catch(fail);
    });
    var del = tr.querySelector('[data-del]');
    if (del) del.addEventListener('click', function () {
      if (confirm('Supprimer cette formule ? Si des projets l’utilisent, elle sera seulement désactivée.')) api('DELETE', '/api/admin/formulas/' + f.id).then(function () { return loadFormulas(); }).catch(fail);
    });
    return tr;
  }
  $('formulaAdd').addEventListener('click', function () {
    $('formulasBody').appendChild(formulaRow({ name: '', max_contributors: 10, price_cents: 0, shopify_variant_id: '', shopify_sku: '', sort_order: 99, active: true }));
  });

  /* -------------------------------------------------------------- réglages */
  function loadSettings() {
    return Promise.all([api('GET', '/api/admin/settings'), api('GET', '/api/admin/shopify/events')]).then(function (res) {
      var d = res[0];
      Array.prototype.forEach.call(document.querySelectorAll('#settingsForm [data-key]'), function (inp) {
        var v = d.settings[inp.dataset.key];
        inp.value = v == null ? '' : v;
      });
      $('envInfo').innerHTML = 'Adresse publique : <b>' + esc(d.env.baseUrl) + '</b><br>Emails : ' + esc(d.env.mail) + '<br>Webhook Shopify : ' + esc(d.env.shopifyWebhook) +
        (d.env.shopifyDomain ? ' (' + esc(d.env.shopifyDomain) + ')' : '') + '<br>URL à déclarer dans Shopify (Paramètres › Notifications › Webhooks, événement « Paiement de commande ») : <code>' + esc(d.env.webhookUrl) + '</code><br>Compression audio : ' + esc(d.env.ffmpeg);
      var grid = $('visualsGrid');
      grid.innerHTML = '';
      VISUAL_KEYS.forEach(function (pair) {
        var key = pair[0], label = pair[1];
        var c = document.createElement('div');
        c.className = 'card visual';
        c.innerHTML = (d.visuals[key] ? '<img alt="" src="' + esc(d.visuals[key]) + '?v=' + Date.now() + '">' : '<div class="visual-empty">Illustration par défaut</div>') + '<div class="small" style="margin-top:8px"><b>' + esc(label) + '</b></div>' +
          '<div class="row"><input type="file" accept="image/*" data-file style="max-width:160px"><button class="btn inline small" data-up>Envoyer</button>' + (d.visuals[key] ? '<button class="btn inline small ghost danger" data-rm>Retirer</button>' : '') + '</div>';
        c.querySelector('[data-up]').addEventListener('click', function () {
          var f = c.querySelector('[data-file]').files[0];
          if (!f) return toast('Choisissez un fichier', true);
          api('POST', '/api/admin/visuals/' + key, f, { headers: { 'Content-Type': f.type || 'image/jpeg' } }).then(function () { toast('Visuel mis à jour'); return loadSettings(); }).catch(fail);
        });
        var rm = c.querySelector('[data-rm]');
        if (rm) rm.addEventListener('click', function () { api('DELETE', '/api/admin/visuals/' + key).then(function () { return loadSettings(); }).catch(fail); });
        grid.appendChild(c);
      });
      var ev = res[1].events;
      $('eventsBody').innerHTML = ev.length ? ev.map(function (e) {
        return '<tr><td class="small nowrap">' + fmtDate(e.received_at) + '</td><td class="small">' + esc(e.topic) + '</td><td class="small">' + esc(e.order_id || '') + '</td><td class="small">' + esc(e.result || 'en cours') + '</td></tr>';
      }).join('') : '<tr><td colspan="4" class="muted">Aucun webhook reçu.</td></tr>';
    });
  }
  $('settingsSave').addEventListener('click', function () {
    var body = {};
    Array.prototype.forEach.call(document.querySelectorAll('#settingsForm [data-key]'), function (inp) { body[inp.dataset.key] = inp.value; });
    api('PUT', '/api/admin/settings', body).then(function () { toast('Réglages enregistrés'); }).catch(fail);
  });
  $('testEmailBtn').addEventListener('click', function () {
    api('POST', '/api/admin/email/test', { to: $('testEmailTo').value }).then(function (r) { toast(r.ok ? 'Email de test envoyé (ou journalisé)' : 'Envoi impossible, voir la configuration', !r.ok); }).catch(fail);
  });
  $('jobsRun').addEventListener('click', function () { api('POST', '/api/admin/jobs/run').then(function () { toast('Tâches exécutées'); }).catch(fail); });
  $('replayBtn').addEventListener('click', function () {
    var order;
    try { order = JSON.parse($('replayJson').value); } catch (_) { return toast('JSON invalide', true); }
    if (order.order) order = order.order;
    api('POST', '/api/admin/shopify/replay', { order: order }).then(function (r) {
      $('replayResult').classList.remove('hidden');
      $('replayResult').textContent = JSON.stringify(r, null, 2);
      toast(r.created.length + ' projet(s) créé(s)');
    }).catch(fail);
  });

  /* ----------------------------------------------------- cartes (historique) */
  var lastBatch = null;
  function loadCards() {
    return api('GET', '/api/admin/cards').then(function (data) {
      var cards = data.cards;
      $('statTotal').textContent = cards.length;
      $('statPending').textContent = cards.filter(function (c) { return c.status === 'pending'; }).length;
      $('statRecorded').textContent = cards.filter(function (c) { return c.status === 'recorded'; }).length;
      var body = $('cardsBody');
      body.innerHTML = cards.length ? '' : '<tr><td colspan="6" class="muted">Aucune carte.</td></tr>';
      cards.forEach(function (c) {
        var tr = document.createElement('tr');
        var url = data.baseUrl + '/c/' + c.slug;
        tr.innerHTML = '<td class="mono"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a></td>' +
          '<td><span class="tag ' + c.status + '">' + (c.status === 'recorded' ? 'enregistrée' : 'en attente') + '</span></td>' +
          '<td>' + (c.duration_s ? Math.round(c.duration_s) + ' s' : '—') + '</td><td>' + (c.has_photo ? 'oui' : '—') + '</td>' +
          '<td class="small nowrap">' + fmtDate(c.created_at) + '</td><td class="small nowrap">' + fmtDate(c.recorded_at) + '</td>';
        body.appendChild(tr);
      });
    });
  }
  $('generateBtn').addEventListener('click', function () {
    var count = Number($('batchCount').value);
    if (!count || count < 1 || count > 1000) return;
    var btn = this;
    btn.disabled = true;
    api('POST', '/api/admin/cards', { count: count }).then(function (data) {
      lastBatch = data.cards;
      $('batchResult').classList.remove('hidden');
      return loadCards();
    }).catch(fail).finally(function () { btn.disabled = false; });
  });
  $('downloadCsv').addEventListener('click', function () {
    if (!lastBatch) return;
    var csv = 'url_nfc;code_activation\n' + lastBatch.map(function (c) { return c.url + ';' + c.code; }).join('\n') + '\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'cartes-ravive-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  });
})();
