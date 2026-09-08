'use strict';

/* ravive — parcours destinataire (maquette « destinataire v3 »).
   Découverte : accueil → compteur → reveal (un souvenir par proche) → fin → « Leurs mots ».
   Retour     : bon retour → reveal aléatoire (un souvenir par proche) → « Leurs mots ».
   Même expérience en mode aperçu (organisateur / admin), sans consommer le reveal. */

(function () {
  var R = window.RV;
  var D = window.RAVIVE_STATE || {};
  var app = document.getElementById('app');
  var esc = R.esc;
  var CATS = {};
  (D.categories || []).forEach(function (c) { CATS[c.key] = c; });

  var GRADS = [['#C9A98A', '#9C7A55'], ['#B9A48C', '#8A7256'], ['#CBB196', '#A07E5B'], ['#B79C86', '#877055'], ['#C4A87F', '#987a4c'], ['#BFAE93', '#8f7a5a'], ['#CDB08A', '#9d7c50'], ['#B49C82', '#82694c']];
  function grad(n) { var g = GRADS[n % GRADS.length]; return 'linear-gradient(150deg,' + g[0] + ',' + g[1] + ')'; }
  var PHOTOBG = 'linear-gradient(165deg,#5d3f52 0%,#9c5a51 42%,#cd7f4f 72%,#e6a25f 92%)';

  function simple(title, sub) {
    return '<div class="view rc-center fade"><div class="rc-glow"></div><div class="rc-inner">' +
      '<div class="rc-logo">Ravive</div><div class="rc-logo-tl">Pour ne rien oublier de nous</div>' +
      '<div class="rc-orn"><i></i><span>♥</span><i class="r"></i></div>' +
      '<h1 class="rc-h1">' + title + '</h1><div class="rc-sub">' + sub + '</div></div></div>';
  }
  if (D.notFound) { app.innerHTML = simple('Ce cadre n’est pas<br>reconnu.', 'Réessaie de l’approcher de ton téléphone, ou contacte la personne qui te l’a offert.'); return; }
  if (D.notReady) { app.innerHTML = simple('Ce cadre n’est pas<br>encore prêt.', 'Les souvenirs sont en préparation. Reviens un peu plus tard.'); return; }

  var people = D.people || [];
  people.forEach(function (p, i) { p.n = i; });

  var S = { flow: D.firstAccess ? 'first' : 'rescan', sc: null, i: 0, list: [], person: null, pi: 0, audio: null, timer: null, raf: null };

  function stopAll() {
    if (S.audio) { S.audio.pause(); S.audio = null; }
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = null; }
  }
  function render() { try { SC[S.sc](); } catch (e) { console.error(e); } window.scrollTo(0, 0); }
  function go(x) { stopAll(); S.sc = x; render(); }
  var SC = {};

  function previewChip() {
    if (!D.preview) return '';
    return '<div class="rc-chip">Mode aperçu · <a href="#" id="pvflow">' + (S.flow === 'first' ? 'voir l’écran de retour' : 'voir la découverte') + '</a></div>';
  }
  function bindPreview() {
    var a = document.getElementById('pvflow');
    if (a) a.onclick = function (e) { e.preventDefault(); S.flow = S.flow === 'first' ? 'rescan' : 'first'; go(S.flow === 'first' ? 'accueil' : 'retour'); };
  }

  /* ------------------------------------------------------- découverte */
  SC.accueil = function () {
    app.innerHTML = '<div class="view rc-center fade"><div class="rc-glow"></div><div class="rc-inner">' + previewChip() +
      '<div class="rc-logo">Ravive</div><div class="rc-logo-tl">Pour ne rien oublier de nous</div>' +
      '<div class="rc-orn" style="margin-top:24px"><i></i><span>Rien que pour toi</span><i class="r"></i></div>' +
      '<h1 class="rc-h1 big">Ils avaient<br>quelque chose<br>à te dire.</h1>' +
      '<div class="rc-sub">Ceux qui t’aiment ont laissé un mot, une voix, un souvenir.</div>' +
      '<div class="rc-stack"><button class="btn gold" id="go">Découvrir <span class="arrow"></span></button></div>' +
      '</div></div>';
    document.getElementById('go').onclick = function () { go('intro'); };
    bindPreview();
  };

  SC.intro = function () {
    var n = people.length;
    app.innerHTML = '<div class="view rc-center fade"><div class="rc-glow"></div><div class="rc-inner">' +
      '<div class="rc-count">' + n + '</div>' +
      '<h1 class="rc-h1" style="margin-top:14px;font-size:26px">' + (n > 1 ? 'personnes ont' : 'personne a') + '<br>pensé à toi <span class="heart">♥</span></h1>' +
      '<div class="rc-sub">Prends une minute, rien que pour toi.</div>' +
      '<div class="rc-stack"><button class="btn" id="go">Découvrir leurs mots <span class="arrow"></span></button></div>' +
      '</div></div>';
    document.getElementById('go').onclick = startReveal;
  };

  /* ------------------------------------------------------------ reveal */
  function pick(p) {
    if (!p.memories.length) return null;
    if (S.flow === 'rescan') return p.memories[Math.floor(Math.random() * p.memories.length)];
    return p.memories.filter(function (m) { return m.inReveal; })[0] || p.memories[0];
  }
  function startReveal() {
    S.list = people.map(function (p) { return { p: p, m: pick(p) }; }).filter(function (x) { return x.m; });
    if (!S.list.length) { go('biblio'); return; }
    S.i = 0;
    go('reveal');
  }
  SC.reveal = function () { card(S.i); };

  function kickOf(m) { return m.free ? 'Un mot pour toi' : (m.question || (CATS[m.category] ? CATS[m.category].title : 'Un souvenir')); }
  function avatar(p) {
    return '<div class="mava" style="' + (p.selfie ? 'background-image:url(\'' + p.selfie + '\')' : 'background:' + grad(p.n)) + '">' + (p.selfie ? '' : esc(p.name[0])) + '</div>';
  }
  function storyShell(p, m, bars, head, body) {
    var bg = m.photo ? 'background-image:url(\'' + m.photo + '\')' : p.photo ? 'background-image:url(\'' + p.photo + '\')' : 'background:' + grad(p.n);
    return '<div class="mstory"><div class="bg" style="' + bg + '"></div>' + (m.photo || p.photo ? '' : '<div class="mmono">' + esc(p.name[0]) + '</div>') + '<div class="mveil"></div>' +
      '<div class="mprog">' + bars + '</div>' +
      '<div class="mshead">' + avatar(p) + '<div class="mnm">' + esc(p.name) + '</div>' + head + '</div>' +
      body +
      '<div class="mtaps"><div class="l" id="tl"></div><div class="r" id="tr"></div></div></div>';
  }
  function inner(p, m) {
    var k = '<div class="mkick">' + esc(kickOf(m)) + '</div>';
    if (m.kind === 'voice') return k + '<div class="mvoice" id="mv"><button class="pl" id="mplay"><svg width="15" height="17" viewBox="0 0 15 17" fill="currentColor"><path d="M2 2 L13 8.5 L2 15 Z"/></svg></button><div class="w">' + R.bars(22) + '</div><div class="d" id="md">' + R.fmt(m.duration) + '</div></div>';
    if (m.kind === 'photo') return k + '<div class="mphotocap">📷 Une photo rien que pour toi</div>';
    var long = (m.text || '').length > 260;
    return k + '<div class="mnote' + (long ? ' long' : '') + '"><span class="quote">“</span>' + esc(m.text) + '<div class="sig">— ' + esc(p.name) + '</div></div>';
  }

  // Lance l'audio d'un souvenir vocal ; `done` est appelé à la fin de la lecture.
  function playVoice(m, done) {
    var mv = document.getElementById('mv'), mp = document.getElementById('mplay'), fill = document.querySelector('.mprog i[data-cur]');
    if (!mp) return;
    var start = function () {
      if (S.audio && !S.audio.paused) { S.audio.pause(); mv.classList.remove('on'); return; }
      if (!S.audio) {
        S.audio = new Audio(m.audio);
        S.audio.onended = function () { mv.classList.remove('on'); if (fill) fill.style.width = '100%'; if (done) S.timer = setTimeout(done, 900); };
        S.audio.ontimeupdate = function () {
          if (!S.audio) return;
          var d = document.getElementById('md'); if (d) d.textContent = R.fmt(S.audio.currentTime) + ' / ' + R.fmt(m.duration || S.audio.duration || 0);
          if (fill && (m.duration || S.audio.duration)) fill.style.width = Math.min(100, S.audio.currentTime / (m.duration || S.audio.duration) * 100) + '%';
        };
      }
      S.audio.play().then(function () { mv.classList.add('on'); }).catch(function () { /* lecture bloquée : l'utilisateur touchera le bouton */ });
    };
    mp.onclick = function (e) { e.stopPropagation(); start(); };
    start();
  }
  // Barre de progression animée puis passage automatique (texte, photo).
  function autoAdvance(ms, done) {
    var fill = document.querySelector('.mprog i[data-cur]'), t0 = performance.now();
    function frame(now) {
      var p = Math.min(1, (now - t0) / ms);
      if (fill) fill.style.width = (p * 100) + '%';
      if (p >= 1) { done(); return; }
      S.raf = requestAnimationFrame(frame);
    }
    S.raf = requestAnimationFrame(frame);
  }
  function durationFor(m) {
    if (m.kind === 'photo') return 5000;
    return Math.min(14000, Math.max(4500, 3000 + (m.text || '').length * 45));
  }

  function card(i) {
    stopAll();
    var it = S.list[i], p = it.p, m = it.m;
    var bars = S.list.map(function (_, k) { return '<div class="p"><i' + (k === i ? ' data-cur' : '') + ' style="width:' + (k < i ? '100%' : '0') + '"></i></div>'; }).join('');
    var head = S.flow === 'rescan' ? '<button class="skipst" id="mx">Passer ›</button>' : '<button class="mx" id="mx">✕</button>';
    app.innerHTML = storyShell(p, m, bars, head, '<div class="msbody fade">' + inner(p, m) + '</div>');
    document.getElementById('mx').onclick = function () { S.flow === 'rescan' ? go('biblio') : finish(); };
    document.getElementById('tl').onclick = function () { if (S.i > 0) { S.i--; card(S.i); } else card(0); };
    document.getElementById('tr').onclick = next;
    if (m.kind === 'voice') playVoice(m, next); else autoAdvance(durationFor(m), next);
  }
  function next() { if (S.i < S.list.length - 1) { S.i++; card(S.i); } else if (S.flow === 'rescan') go('biblio'); else finish(); }
  function finish() {
    stopAll();
    if (D.firstAccess && !D.preview) { D.firstAccess = false; fetch(D.api + '/reveal-done', { method: 'POST' }).catch(function () {}); }
    go('fin');
  }

  SC.fin = function () {
    app.innerHTML = '<div class="view rc-center fade"><div class="rc-glow"></div><div class="rc-inner">' +
      '<div class="rc-orn"><i></i><span>♥</span><i class="r"></i></div>' +
      '<h1 class="rc-h1">Voilà ce que tu<br>représentes<br>pour <em>eux.</em></h1>' +
      '<div class="rc-sub">Et ce n’est que le début,<br>il te reste encore plein<br>de souvenirs à découvrir.</div>' +
      '<div class="rc-stack"><button class="btn gold" id="lib">Découvrir « Leurs mots »</button><button class="btn line" id="again">Revoir</button></div>' +
      '</div></div>';
    document.getElementById('lib').onclick = function () { go('biblio'); };
    document.getElementById('again').onclick = startReveal;
  };

  /* ------------------------------------------------------------ retour */
  SC.retour = function () {
    app.innerHTML = '<div class="view rc-center fade"><div class="rc-glow"></div><div class="rc-inner">' + previewChip() +
      '<div class="rc-logo" style="font-size:38px">Ravive</div><div class="rc-logo-tl">Pour ne rien oublier de nous</div>' +
      '<div class="rc-orn"><i></i><span>♥</span><i class="r"></i></div>' +
      '<h1 class="rc-h1 big">Bon retour.</h1>' +
      '<div class="rc-sub">Tes proches sont toujours là, quand tu en as besoin.</div>' +
      '<div class="rc-stack"><button class="btn gold" id="again">Revoir un souvenir de chacun</button><button class="btn line" id="lib">Leurs mots</button></div>' +
      '</div></div>';
    document.getElementById('again').onclick = startReveal;
    document.getElementById('lib').onclick = function () { go('biblio'); };
    bindPreview();
  };

  /* ------------------------------------------------------- leurs mots */
  SC.biblio = function () {
    var cells = people.map(function (p) {
      var cnt = p.memories.length;
      return '<div class="rc-person" data-n="' + p.n + '"><div class="rc-ava" style="' + (p.selfie ? 'background-image:url(\'' + p.selfie + '\')' : 'background:' + grad(p.n)) + '">' +
        (p.selfie ? '' : '<span class="pinit">' + esc(p.name[0]) + '</span>') + (cnt > 1 ? '<div class="more">' + cnt + '</div>' : '') + '</div>' +
        '<div class="pn">' + esc(p.name) + '</div></div>';
    }).join('');
    app.innerHTML = '<div class="rc-lib fade"><button class="rc-backb" id="back">‹</button>' +
      '<div class="rc-libhead"><div class="t">Leurs mots <span class="heart">♥</span></div><div class="s">Retrouve ici tout ce qu’ils ont préparé pour toi.<br>Certains avaient encore beaucoup à te raconter…</div></div>' +
      '<div class="rc-grid">' + cells + '</div>' +
      '<div class="foot">Un cadre <a href="/">Ravive</a></div></div>';
    document.getElementById('back').onclick = function () { go(S.flow === 'rescan' ? 'retour' : 'fin'); };
    app.querySelectorAll('.rc-person').forEach(function (el) { el.onclick = function () { S.person = people[Number(el.dataset.n)]; S.pi = 0; go('profil'); }; });
  };

  /* ------------------------------------------------------------ profil */
  SC.profil = function () { pcard(S.pi); };
  function pcard(pi) {
    stopAll();
    var p = S.person, arr = p.memories, m = arr[pi];
    var bars = arr.map(function (_, k) { return '<div class="p"><i' + (k === pi ? ' data-cur' : '') + ' style="width:' + (k < pi ? '100%' : '0') + '"></i></div>'; }).join('');
    var body;
    if (m.kind === 'voice') body = '<div class="msbody">' + inner(p, m) + '</div>';
    else if (m.kind === 'photo') body = '<div class="msbody"><div class="mkick">' + esc(kickOf(m)) + '</div><div class="mphotocap">📷 La photo laissée par ' + esc(p.name) + '</div></div>';
    else body = '<div class="msbody top"><div class="mkick">' + esc(kickOf(m)) + '</div><div class="bigtext">“ ' + esc(m.text) + ' ”<div class="sig">— ' + esc(p.name) + '</div></div></div>';
    app.innerHTML = storyShell(p, m, bars, '<button class="mx" id="mx">✕</button>', body);
    document.getElementById('mx').onclick = function () { go('biblio'); };
    document.getElementById('tl').onclick = function () { if (S.pi > 0) { S.pi--; pcard(S.pi); } };
    document.getElementById('tr').onclick = function () { if (S.pi < arr.length - 1) { S.pi++; pcard(S.pi); } else go('biblio'); };
    if (m.kind === 'voice') playVoice(m, null);
    else { var f = document.querySelector('.mprog i[data-cur]'); if (f) f.style.width = '100%'; }
  }

  go(S.flow === 'first' ? 'accueil' : 'retour');
})();
