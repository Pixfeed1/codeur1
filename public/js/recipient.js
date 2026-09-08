'use strict';

/* ravive — parcours destinataire : reveal façon stories, puis bibliothèque.
   Même expérience en mode aperçu (organisateur / admin), sans consommer le reveal. */

(function () {
  var R = window.RV;
  var D = window.RAVIVE_STATE || {};
  var app = document.getElementById('app');
  var esc = R.esc;
  var S = { sc: 'home', i: 0, audio: null, timer: null, revealDone: false };
  var P = D.recipientName || '';
  var pr = R.pron(D.recipientGender);
  var CATS = {};
  (D.categories || []).forEach(function (c) { CATS[c.key] = c; });

  function centered(em, title, sub, buttons) {
    return '<div class="view center fade"><div style="font-size:44px">' + em + '</div><h1 class="lede" style="font-size:24px;margin-top:12px">' + title + '</h1>' +
      (sub ? '<div class="sub" style="max-width:285px;margin-top:12px">' + sub + '</div>' : '') + (buttons ? '<div class="stack" style="margin-top:26px;width:100%">' + buttons + '</div>' : '') + '</div>';
  }
  if (D.notFound) { app.innerHTML = centered('🤔', 'Ce cadre n’est pas reconnu.', 'Réessaie de l’approcher de ton téléphone, ou contacte la personne qui te l’a offert.'); return; }
  if (D.notReady) { app.innerHTML = centered('⏳', 'Ce cadre n’est pas encore prêt.', 'Les souvenirs sont en préparation. Reviens un peu plus tard !'); return; }

  var reveal = D.items.filter(function (it) { return it.inReveal; });
  function render() { try { SC[S.sc](); } catch (e) { console.error(e); } window.scrollTo(0, 0); }
  function go(x) { stopAudio(); S.sc = x; render(); }
  function stopAudio() { if (S.audio) { S.audio.pause(); S.audio = null; } if (S.timer) { clearTimeout(S.timer); S.timer = null; } }
  var SC = {};

  /* ----------------------------------------------------------- accueil */
  SC.home = function () {
    var first = D.firstAccess && !S.revealDone;
    if (first) {
      app.innerHTML = '<div class="view center fade" style="background:#241a12;color:#fff;min-height:100dvh">' +
        (D.preview ? '<div class="chip" style="margin-bottom:18px">Mode aperçu · rien n’est consommé</div>' : '') +
        '<div class="brand" style="color:#D8BE8C">Ravive</div>' +
        '<h1 class="lede" style="margin-top:22px;color:#fff">' + esc(P) + ',<br>' + reveal.length + ' ' + (reveal.length > 1 ? 'proches ont' : 'proche a') + ' laissé<br>quelque chose pour toi.</h1>' +
        '<div class="sub" style="color:rgba(255,255,255,.75);max-width:285px">' + (D.organizerName ? esc(D.organizerName) + ' a réuni tout le monde en secret. ' : '') + 'Installe-toi, monte le son. <span class="heart">♥</span></div>' +
        '<div class="stack" style="max-width:260px;margin-top:28px;width:100%"><button class="btn gold" id="start">Découvrir <span class="arrow"></span></button></div>' +
        (D.frameText ? '<div style="font-family:Caveat,cursive;font-size:24px;color:#D8BE8C;margin-top:30px">' + esc(D.frameText) + '</div>' : '') +
        '</div>';
      document.getElementById('start').onclick = function () { S.i = 0; go('story'); };
      return;
    }
    app.innerHTML = '<div class="view center fade">' +
      (D.preview ? '<div class="chip" style="margin-bottom:18px">Mode aperçu</div>' : '') +
      '<div class="brand">Ravive</div>' +
      '<h1 class="lede" style="margin-top:22px">Tes souvenirs<br>sont là, ' + esc(P) + '.</h1>' +
      '<div class="sub" style="max-width:285px">' + D.people.length + ' proches, ' + D.items.length + ' souvenirs. Toujours à portée de main, aujourd’hui comme dans dix ans.</div>' +
      '<div class="stack" style="max-width:280px;margin-top:28px;width:100%"><button class="btn gold" id="again">▶  Revivre le reveal</button><button class="btn line" id="lib">Ouvrir la bibliothèque</button></div>' +
      '<div class="foot">Un cadre <a href="/">Ravive</a></div></div>';
    document.getElementById('again').onclick = function () { S.i = 0; go('story'); };
    document.getElementById('lib').onclick = function () { go('library'); };
  };

  /* ------------------------------------------------------------- story */
  SC.story = function () { showItem(S.i); };
  function showItem(i) {
    stopAudio();
    if (!reveal.length) { go('library'); return; }
    var it = reveal[i];
    var bars = reveal.map(function (_, k) { return '<div class="p"><i style="width:' + (k <= i ? '100%' : '0') + '"></i></div>'; }).join('');
    var kick = it.free ? 'Un mot pour toi' : (it.question || (CATS[it.category] ? CATS[it.category].title : 'Un souvenir'));
    var inner;
    if (it.kind === 'voice') inner = '<div class="mkick">' + esc(kick) + '</div><div class="mvoice" id="mv"><button class="pl" id="mplay"><svg width="15" height="17" viewBox="0 0 15 17" fill="currentColor"><path d="M2 2 L13 8.5 L2 15 Z"/></svg></button><div class="w">' + R.bars(20) + '</div><div class="d" id="md">' + R.fmt(it.duration) + '</div></div>';
    else if (it.kind === 'photo') inner = '<div class="mkick">' + esc(kick) + '</div><div class="mphotocap">📸 Une photo de ' + esc(it.name) + '</div>';
    else inner = '<div class="mkick">' + esc(kick) + '</div><div class="mnote' + ((it.text || '').length > 220 ? ' long' : '') + '">“ ' + esc(it.text) + ' ”</div>';
    var bg = it.background ? 'background-image:url(\'' + it.background + '\')' : '';
    app.innerHTML = '<div class="mstory"><div class="bg' + (bg ? '' : ' grad') + '" style="' + bg + '"></div><div class="mveil"></div>' +
      '<div class="mprog">' + bars + '</div>' +
      '<div class="mshead"><div class="mava" style="' + (it.selfie ? 'background-image:url(\'' + it.selfie + '\')' : '') + '">' + (it.selfie ? '' : esc(it.name[0])) + '</div><div><div class="mnm">' + esc(it.name) + '</div>' + (it.relation ? '<div class="mrel">' + esc(relLabel(it.relation)) + '</div>' : '') + '</div><button class="mx" id="mx">✕</button></div>' +
      '<div class="msbody">' + inner + '</div>' +
      '<div class="mtaps"><div class="l" id="ml"></div><div class="r" id="mr"></div></div>' +
      '<div class="mtaphint">' + (i < reveal.length - 1 ? 'Touche à droite pour le suivant' : 'Touche à droite pour terminer') + '</div></div>';
    document.getElementById('mx').onclick = finishReveal;
    document.getElementById('ml').onclick = function () { if (S.i > 0) { S.i--; showItem(S.i); } };
    document.getElementById('mr').onclick = next;
    var mp = document.getElementById('mplay');
    if (mp) {
      var mv = document.getElementById('mv');
      var play = function () {
        if (S.audio && !S.audio.paused) { S.audio.pause(); mv.classList.remove('on'); return; }
        if (!S.audio) {
          S.audio = new Audio(it.audio);
          S.audio.onended = function () { mv.classList.remove('on'); S.timer = setTimeout(next, 1500); };
          S.audio.ontimeupdate = function () { var d = document.getElementById('md'); if (d && S.audio) d.textContent = R.fmt(S.audio.currentTime) + ' / ' + R.fmt(it.duration); };
        }
        S.audio.play().then(function () { mv.classList.add('on'); }).catch(function () {});
      };
      mp.onclick = play;
      // lecture automatique quand c'est possible (l'utilisateur vient de toucher l'écran)
      play();
    }
  }
  function next() {
    if (S.i < reveal.length - 1) { S.i++; showItem(S.i); } else finishReveal();
  }
  function finishReveal() {
    stopAudio();
    S.revealDone = true;
    if (D.firstAccess && !D.preview) { D.firstAccess = false; fetch(D.api + '/reveal-done', { method: 'POST' }).catch(function () {}); }
    go('after');
  }
  SC.after = function () {
    app.innerHTML = centered('🤎', 'Et ce n’est pas tout.', (D.items.length - reveal.length > 0 ? 'Tes proches ont laissé ' + (D.items.length - reveal.length) + ' autres souvenirs. ' : '') + 'Tout reste ici, pour toujours. Reviens quand tu veux en approchant ton téléphone du cadre.',
      '<button class="btn gold" id="lib">Voir tous les souvenirs</button><button class="btn line" id="again">Revoir le reveal</button>');
    document.getElementById('lib').onclick = function () { go('library'); };
    document.getElementById('again').onclick = function () { S.i = 0; go('story'); };
  };

  /* ------------------------------------------------------- bibliothèque */
  function relLabel(r) { return { ami: 'ami·e', famille: 'famille', amour: 'en couple', collegue: 'collègue', autre: '' }[r] || ''; }
  SC.library = function () {
    var people = D.people.map(function (p) {
      var mems = p.memories.map(function (m) {
        var q = m.free ? 'Un mot pour toi' : (m.question || '');
        var body = m.kind === 'text' ? '<div class="txt">' + esc(m.text) + '</div>'
          : m.kind === 'voice' ? '<div class="player"><button class="pbtn" data-audio="' + esc(m.audio) + '">▶</button><div class="wave">' + R.bars(16) + '</div><div class="pt">' + R.fmt(m.duration) + '</div></div>'
          : '<img src="' + esc(m.photo) + '" alt="" loading="lazy">';
        return '<div class="lib-mem"><div class="q">' + esc(q) + (m.inReveal ? ' <span class="star">★</span>' : '') + '</div>' + body + '</div>';
      }).join('');
      return '<div class="lib-person" data-p="' + p.id + '"><div class="lib-head"><div class="av" style="' + (p.selfie ? 'background-image:url(\'' + p.selfie + '\')' : p.photo ? 'background-image:url(\'' + p.photo + '\')' : '') + '">' + (p.selfie || p.photo ? '' : esc(p.name[0])) + '</div>' +
        '<div><div class="nm">' + esc(p.name) + '</div><div class="cnt">' + (relLabel(p.relation) ? relLabel(p.relation) + ' · ' : '') + p.memories.length + ' souvenir' + (p.memories.length > 1 ? 's' : '') + '</div></div><div class="chev">›</div></div>' +
        '<div class="lib-mems">' + mems + '</div></div>';
    }).join('');
    app.innerHTML = '<div class="view fade"><div class="head"><button class="backarr" id="back">‹</button><span class="kicker">Ta bibliothèque</span><h1>Les souvenirs<br>de tes proches</h1></div>' +
      '<div class="body"><div class="sub" style="margin:-2px 0 16px">' + D.people.length + ' proches · ' + D.items.length + ' souvenirs. Touche un prénom pour ouvrir.</div>' + people +
      '<div class="foot">★ = montré au reveal · Un cadre <a href="/">Ravive</a></div></div></div>';
    document.getElementById('back').onclick = function () { go('home'); };
    app.querySelectorAll('.lib-head').forEach(function (h) { h.onclick = function () { h.parentNode.classList.toggle('open'); }; });
    app.querySelectorAll('[data-audio]').forEach(function (b) {
      b.onclick = function () {
        var wave = b.parentNode.querySelector('.wave'), pt = b.parentNode.querySelector('.pt');
        if (S.audio && S.audio.dataset && S.audio.dataset.src === b.dataset.audio) {
          if (S.audio.paused) { S.audio.play(); b.textContent = '❚❚'; wave.classList.add('on'); } else { S.audio.pause(); b.textContent = '▶'; wave.classList.remove('on'); }
          return;
        }
        stopAudio();
        app.querySelectorAll('[data-audio]').forEach(function (x) { x.textContent = '▶'; x.parentNode.querySelector('.wave').classList.remove('on'); });
        S.audio = new Audio(b.dataset.audio);
        S.audio.dataset = { src: b.dataset.audio };
        S.audio.onended = function () { b.textContent = '▶'; wave.classList.remove('on'); };
        S.audio.ontimeupdate = function () { if (S.audio) pt.textContent = R.fmt(S.audio.currentTime) + ' / ' + R.fmt(S.audio.duration || 0); };
        S.audio.play().then(function () { b.textContent = '❚❚'; wave.classList.add('on'); }).catch(function () {});
      };
    });
  };

  render();
})();
