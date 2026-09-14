'use strict';

/* ravive — parcours destinataire (maquettes v3, v8 puis finales V1.1).
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
      '<h1 class="rc-h1" style="font-size:30px">' + title + '</h1><div class="rc-sub">' + sub + '</div></div></div>';
  }
  if (D.notFound) { app.innerHTML = simple('Ce cadre n’est pas reconnu.', 'Réessaie de l’approcher de ton téléphone, ou contacte la personne qui te l’a offert.'); return; }
  if (D.notReady) { app.innerHTML = simple('Ce cadre n’est pas encore prêt.', 'Les souvenirs sont en préparation. Reviens un peu plus tard.'); return; }

  var people = D.people || [];
  people.forEach(function (p, i) { p.n = i; });

  var S = { flow: D.firstAccess ? 'first' : 'rescan', sc: null, i: 0, list: [], person: null, pi: 0, audio: null, timer: null, raf: null };

  function stopAll() {
    if (typeof player !== 'undefined') player.stop();
    if (typeof stopHalo !== 'undefined' && stopHalo) { stopHalo(); stopHalo = null; }
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
    if (a) a.onclick = function (e) { e.preventDefault(); S.flow = S.flow === 'first' ? 'rescan' : 'first'; go(S.flow === 'first' ? 'scan' : 'retour'); };
  }

  /* ------------------------------------------------------- découverte (maquette v8) */
  var HALO_POS = [[16, 20, 30], [76, 15, 26], [49, 6, 24], [7, 47, 28], [90, 45, 30], [29, 82, 24], [69, 84, 26], [3, 74, 22], [94, 71, 22], [46, 93, 20]];
  function motes() {
    var M = [[12, 16, 15, 2], [80, 22, 19, 8], [30, 12, 13, 5], [63, 18, 17, 11], [46, 14, 14, 15], [88, 10, 12, 3], [6, 20, 18, 9], [70, 12, 16, 13]];
    return '<div class="motes">' + M.map(function (m) { return '<i style="left:' + m[0] + '%;bottom:-24px;width:' + m[1] + 'px;height:' + m[1] + 'px;animation-duration:' + m[2] + 's;animation-delay:-' + m[3] + 's"></i>'; }).join('') + '</div>';
  }
  // Compte à rebours 3-2-1 sur fond sombre, puis l'écran compteur
  SC.scan = function () {
    app.innerHTML = '<div class="scanview">' + previewChip() + '<div class="scan-wm">Ravive</div><div class="scan-n" id="scanN"></div><div class="scan-hint">Reçois ce que l’on t’a laissé…</div></div>';
    bindPreview();
    var el = document.getElementById('scanN'), seq = [3, 2, 1], k = 0;
    var tick = function () {
      if (S.sc !== 'scan') return;
      if (k >= seq.length) { go('intro'); return; }
      el.innerHTML = '<span class="scan-num">' + seq[k] + '</span>'; k++;
      S.timer = setTimeout(tick, 780);
    };
    tick();
  };
  SC.accueil = function () { go('scan'); };

  // Le chiffre monte de 0 au nombre de proches, les proches apparaissent autour au fil du compte
  function animateCount(el, to, dur, onTick) {
    if (!el) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to; onTick(to); return; }
    var start = performance.now();
    (function step(now) {
      var p = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - p, 3), v = Math.round(e * to);
      el.textContent = v; onTick(v);
      if (p < 1) S.raf = requestAnimationFrame(step); else { el.textContent = to; onTick(to); }
    })(start);
  }
  SC.intro = function () {
    var n = people.length, chips = people.slice(0, HALO_POS.length);
    var halo = chips.map(function (p, i) {
      var pos = HALO_POS[i], th = Math.max(1, Math.round((i + 1) * n / chips.length));
      var face = p.selfie ? 'background-image:url(\'' + p.selfie + '\');background-size:cover;background-position:center' : 'background:' + grad(p.n);
      return '<div class="h" data-th="' + th + '" style="left:' + pos[0] + '%;top:' + pos[1] + '%;width:' + pos[2] + 'px;height:' + pos[2] + 'px;margin-left:' + (-pos[2] / 2) + 'px;margin-top:' + (-pos[2] / 2) + 'px">' +
        '<div class="hf" style="' + face + ';font-size:' + Math.round(pos[2] * 0.42) + 'px;animation-delay:' + (i * 0.35).toFixed(2) + 's">' + (p.selfie ? '' : esc(p.name[0])) + '</div></div>';
    }).join('');
    var pr = D.recipientGender === 'm' ? 'Prêt' : D.recipientGender === 'f' ? 'Prête' : 'Prêt·e';
    app.innerHTML = '<div class="view rc-center soft-in"><div class="rc-glow breath"></div>' + motes() +
      '<div class="top-wm rv" style="animation-delay:.15s">Ravive</div>' +
      '<div class="rc-inner">' + previewChip() +
      '<div class="countwrap"><div class="halo" id="halo">' + halo + '</div><div class="rc-count rv-soft" id="counter" style="animation-delay:.2s">0</div></div>' +
      '<h1 class="rc-h1 rv" style="margin:8px auto 0;font-size:25px;line-height:1.24;max-width:20ch;animation-delay:.9s">' + (n > 1 ? 'personnes ont' : 'personne a') + ' quelque chose à te dire.</h1>' +
      '<div class="rc-sub rv" style="animation-delay:1.5s">' + pr + ' à découvrir ce qu’' + (n > 1 ? 'elles' : 'elle') + ' t’' + (n > 1 ? 'ont' : 'a') + ' laissé ?</div>' +
      '<div class="rc-stack rv" style="animation-delay:2.1s"><button class="btn gold" id="go">Découvrir mes souvenirs <span class="arrow"></span></button></div>' +
      '</div></div>';
    document.getElementById('go').onclick = startReveal;
    bindPreview();
    var chipEls = Array.prototype.slice.call(document.querySelectorAll('#halo .h'));
    var onTick = function (v) { chipEls.forEach(function (c) { if (v >= Number(c.dataset.th)) c.classList.add('show'); }); };
    S.timer = setTimeout(function () { animateCount(document.getElementById('counter'), n, 1900, onTick); }, 600);
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
    S.openSig = S.flow === 'first';
    go('reveal');
  }
  SC.reveal = function () {
    if (S.openSig) { S.openSig = false; S.timer = R.opening(app, 'Un souvenir pour ' + (D.recipientName || 'toi'), function () { if (S.sc === 'reveal') card(0); }); return; }
    card(S.i);
  };

  function kickOf(m) { return m.free ? 'Un mot pour toi' : (m.question || (CATS[m.category] ? CATS[m.category].title : 'Un souvenir')); }
  function avatar(p) {
    return '<div class="mava" style="' + (p.selfie ? 'background-image:url(\'' + p.selfie + '\')' : 'background:' + grad(p.n)) + '">' + (p.selfie ? '' : esc(p.name[0])) + '</div>';
  }
  var REL = { ami: 'ton ami·e', famille: 'ta famille', amour: 'ton amour', collegue: 'ton·ta collègue' };
  // V1.1 : une story par format (vocal, texte, photo + vocal, photo + texte, photo seule) — rendu partagé RV.storyView
  function itemOf(m) {
    return {
      hasAudio: m.kind === 'voice', hasText: m.kind === 'text' && !!(m.text || '').trim(), hasPhoto: !!m.photo,
      text: m.text, duration: m.duration, photoFull: m.photoFull || m.photo, photoFocus: m.photoFocus, questionPos: m.questionPos, overlayDark: m.overlayDark,
      category: m.category, free: m.free, question: m.free ? '' : (m.question || ''),
    };
  }
  function storyShell(p, m, bars, head) {
    var v = R.storyView(itemOf(m), {
      kickVoice: m.free ? 'Un mot pour toi' : (m.photo ? 'Un souvenir pour toi' : 'Sa réponse à…'),
      kickText: m.free ? 'Un mot pour toi' : 'Sa réponse à…',
      kickPhoto: m.free ? 'Une photo pour toi' : 'Ton souvenir en image',
      signature: p.name,
    });
    S.halo = v.halo;
    return '<div class="mstory ' + v.cls + '" style="' + v.style + '">' + v.html +
      '<div class="mprog">' + bars + '</div>' +
      '<div class="mshead">' + avatar(p) + '<div class="mhinfo"><span class="n2">' + esc(p.name) + '</span><span class="s2">' + esc(REL[p.relation] || 'pour toi') + '</span></div>' + head + '</div>' +
      '<div class="mtaps"><div class="l" id="tl"></div><div class="r" id="tr"></div></div></div>';
  }

  // Lecteur unique (déverrouillé au premier geste, voir RV.audioPlayer) : les vocaux
  // s'enchaînent automatiquement, même sur iOS. Le halo suit le niveau sonore réel.
  var player = R.audioPlayer();
  var stopHalo = null;
  function playVoice(m, done) {
    var btn = document.getElementById('mpauseBtn'), fill = document.querySelector('.mprog i[data-cur]');
    var paused = false;
    var dur = function () { return m.duration || player.el.duration || 1; };
    player.play(m.audio, {
      onended: function () { if (fill) fill.style.width = '100%'; if (btn) btn.innerHTML = R.icons.play; if (done) S.timer = setTimeout(done, 900); },
      ontimeupdate: function () { if (fill) fill.style.width = Math.min(100, player.el.currentTime / dur() * 100) + '%'; },
    }).catch(function () { paused = true; if (btn) btn.innerHTML = R.icons.play; /* lecture bloquée : le bouton reste disponible */ });
    if (stopHalo) stopHalo();
    stopHalo = R.halo(function () { return player.level(); }, function () { return player.el.currentTime || 0; }, dur, function () { return paused || player.el.paused; });
    if (btn) btn.onclick = function (e) {
      e.stopPropagation();
      if (player.el.paused) { paused = false; player.el.play().catch(function () {}); btn.innerHTML = R.icons.pause; }
      else { paused = true; player.pause(); btn.innerHTML = R.icons.play; }
    };
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
    if (m.photo) return 9000; // photo + texte : le temps d'ouvrir le message
    return Math.min(30000, Math.max(4500, 3000 + (m.text || '').length * 45));
  }

  function card(i) {
    stopAll();
    var it = S.list[i], p = it.p, m = it.m;
    var bars = S.list.map(function (_, k) { return '<div class="p"><i' + (k === i ? ' data-cur' : '') + ' style="width:' + (k < i ? '100%' : '0') + '"></i></div>'; }).join('');
    var head = S.flow === 'rescan' ? '<button class="skipst" id="mx">Passer ›</button>' : '<button class="mx" id="mx">' + R.icons.x + '</button>';
    app.innerHTML = storyShell(p, m, bars, head);
    document.getElementById('mx').onclick = function () { S.flow === 'rescan' ? go('biblio') : finish(); };
    document.getElementById('tl').onclick = function () { if (S.i > 0) { S.i--; card(S.i); } else card(0); };
    document.getElementById('tr').onclick = next;
    R.bindTextPanel();
    if (m.kind === 'voice') playVoice(m, next); else autoAdvance(durationFor(m), next);
  }
  function next() { if (S.i < S.list.length - 1) { S.i++; card(S.i); } else if (S.flow === 'rescan') go('biblio'); else finish(); }
  function finish() {
    stopAll();
    if (D.firstAccess && !D.preview) { D.firstAccess = false; fetch(D.api + '/reveal-done', { method: 'POST' }).catch(function () {}); }
    go('fin');
  }

  SC.fin = function () {
    app.innerHTML = '<div class="view rc-center fade"><div class="rc-glow"></div>' + motes() + '<div class="rc-inner">' +
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
    app.innerHTML = '<div class="view rc-center fade"><div class="rc-glow"></div>' + motes() + '<div class="rc-inner">' + previewChip() +
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
    app.innerHTML = storyShell(p, m, bars, '<button class="mx" id="mx">' + R.icons.x + '</button>');
    document.getElementById('mx').onclick = function () { go('biblio'); };
    document.getElementById('tl').onclick = function () { if (S.pi > 0) { S.pi--; pcard(S.pi); } };
    document.getElementById('tr').onclick = function () { if (S.pi < arr.length - 1) { S.pi++; pcard(S.pi); } else go('biblio'); };
    R.bindTextPanel();
    if (m.kind === 'voice') playVoice(m, null);
    else { var f = document.querySelector('.mprog i[data-cur]'); if (f) f.style.width = '100%'; }
  }

  go(S.flow === 'first' ? 'scan' : 'retour');
})();
