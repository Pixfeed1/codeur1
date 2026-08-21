'use strict';

/* ravive — logique front des deux parcours (acheteur / destinataire) */

(function () {
  var state = window.RAVIVE_STATE || {};
  var slug = state.slug;
  var token = null;

  var recordedBlob = null;
  var recordedMime = null;
  var recordedDuration = 0;

  var screens = {
    activate: document.getElementById('screen-activate'),
    record: document.getElementById('screen-record'),
    preview: document.getElementById('screen-preview'),
    done: document.getElementById('screen-done'),
    listen: document.getElementById('screen-listen'),
  };
  var backBtn = document.getElementById('backBtn');
  var current = null;

  function show(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('active', k === name);
    });
    current = name;
    backBtn.classList.toggle('show', name === 'record' || name === 'preview');
    window.scrollTo(0, 0);
  }

  backBtn.addEventListener('click', function () {
    if (current === 'preview') { stopPreview(); show('record'); }
    else if (current === 'record') { stopRecording(true); show('activate'); }
  });

  function fmt(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function bars(el, n) {
    el.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var b = document.createElement('span');
      b.style.height = (8 + Math.round(24 * Math.abs(Math.sin(i * 1.7 + 0.6)))) + 'px';
      el.appendChild(b);
    }
  }
  bars(document.getElementById('previewBars'), 12);
  bars(document.getElementById('listenBars'), 12);

  /* ------------------------------------------------------------------ */
  /* Parcours destinataire : la carte a déjà son message                */
  /* ------------------------------------------------------------------ */
  if (state.status === 'recorded') {
    var listenAudio = new Audio('/api/cards/' + slug + '/audio');
    listenAudio.preload = 'metadata';
    var listenBg = document.getElementById('listenBg');
    if (state.hasPhoto) {
      listenBg.style.backgroundImage = 'url(/api/cards/' + slug + '/photo)';
      listenBg.classList.add('on');
    }
    var listenPlay = document.getElementById('listenPlay');
    var iconPlay = document.getElementById('listenIconPlay');
    var iconPause = document.getElementById('listenIconPause');
    var listenTime = document.getElementById('listenTime');
    var listenProgress = document.getElementById('listenProgress');

    if (state.duration) listenTime.textContent = fmt(state.duration);
    listenAudio.addEventListener('loadedmetadata', function () {
      if (isFinite(listenAudio.duration)) listenTime.textContent = fmt(listenAudio.duration);
    });

    listenPlay.addEventListener('click', function () {
      if (listenAudio.paused) listenAudio.play(); else listenAudio.pause();
    });
    function syncIcon() {
      iconPlay.style.display = listenAudio.paused ? '' : 'none';
      iconPause.style.display = listenAudio.paused ? 'none' : '';
      listenBg.classList.toggle('playing', !listenAudio.paused);
    }
    listenAudio.addEventListener('play', syncIcon);
    listenAudio.addEventListener('pause', syncIcon);
    listenAudio.addEventListener('timeupdate', function () {
      var d = isFinite(listenAudio.duration) && listenAudio.duration
        ? listenAudio.duration : (state.duration || 1);
      listenProgress.style.width = Math.min(100, (listenAudio.currentTime / d) * 100) + '%';
      listenTime.textContent = fmt(listenAudio.currentTime) + ' / ' + fmt(d);
    });
    listenAudio.addEventListener('ended', function () {
      listenProgress.style.width = '0%';
      if (state.duration) listenTime.textContent = fmt(state.duration);
      syncIcon();
    });

    show('listen');
    return;
  }

  /* ------------------------------------------------------------------ */
  /* Parcours acheteur — étape 1 : code d'activation                    */
  /* ------------------------------------------------------------------ */
  var codeForm = document.getElementById('codeForm');
  var codeInput = document.getElementById('codeInput');
  var codeError = document.getElementById('codeError');
  var codeSubmit = document.getElementById('codeSubmit');

  codeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    codeError.classList.remove('show');
    codeSubmit.disabled = true;
    codeSubmit.textContent = 'Vérification…';

    fetch('/api/cards/' + slug + '/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeInput.value }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.ok) {
          token = res.body.token;
          show('record');
          return;
        }
        var msg = 'Une erreur est survenue. Réessaie dans un instant.';
        if (res.status === 401) msg = 'Ce code ne correspond pas. Vérifie le code inscrit dans le packaging.';
        if (res.status === 429) msg = 'Trop d’essais. Patiente quelques minutes avant de réessayer.';
        if (res.status === 423) msg = 'Cette carte a déjà son message : elle ne peut plus être modifiée.';
        codeError.textContent = msg;
        codeError.classList.add('show');
      })
      .catch(function () {
        codeError.textContent = 'Connexion impossible. Vérifie ton réseau puis réessaie.';
        codeError.classList.add('show');
      })
      .finally(function () {
        codeSubmit.disabled = false;
        codeSubmit.textContent = 'Commencer';
      });
  });

  /* ------------------------------------------------------------------ */
  /* Étape 2 : enregistrement (MediaRecorder + waveform live)           */
  /* ------------------------------------------------------------------ */
  var recordBtn = document.getElementById('recordBtn');
  var recIconMic = document.getElementById('recIconMic');
  var recIconStop = document.getElementById('recIconStop');
  var recTimer = document.getElementById('recTimer');
  var recMax = document.getElementById('recMax');
  var recHint = document.getElementById('recHint');
  var recError = document.getElementById('recError');
  var canvas = document.getElementById('waveCanvas');
  var ctx2d = canvas.getContext('2d');

  var maxDuration = state.maxDuration || 180;
  recMax.textContent = '/ ' + fmt(maxDuration);

  var mediaStream = null;
  var recorder = null;
  var chunks = [];
  var audioCtx = null;
  var analyser = null;
  var rafId = null;
  var startedAt = 0;
  var timerId = null;

  function pickMime() {
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < candidates.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function drawWave() {
    var data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    var w = canvas.width, h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);
    var barCount = 32;
    var gap = 8;
    var barW = (w - gap * (barCount - 1)) / barCount;
    ctx2d.fillStyle = '#dd7355';
    for (var i = 0; i < barCount; i++) {
      var v = data[Math.floor((i / barCount) * data.length * 0.7)] / 255;
      var bh = Math.max(8, v * h * 0.9);
      var x = i * (barW + gap);
      var y = (h - bh) / 2;
      ctx2d.beginPath();
      if (ctx2d.roundRect) ctx2d.roundRect(x, y, barW, bh, barW / 2);
      else ctx2d.rect(x, y, barW, bh);
      ctx2d.fill();
    }
    rafId = requestAnimationFrame(drawWave);
  }

  function drawIdleWave() {
    var w = canvas.width, h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.fillStyle = 'rgba(221,115,85,0.35)';
    var barCount = 32, gap = 8;
    var barW = (w - gap * (barCount - 1)) / barCount;
    for (var i = 0; i < barCount; i++) {
      var bh = 10 + 30 * Math.abs(Math.sin(i * 0.9));
      var x = i * (barW + gap);
      var y = (h - bh) / 2;
      ctx2d.beginPath();
      if (ctx2d.roundRect) ctx2d.roundRect(x, y, barW, bh, barW / 2);
      else ctx2d.rect(x, y, barW, bh);
      ctx2d.fill();
    }
  }
  drawIdleWave();

  function startRecording() {
    recError.classList.remove('show');
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      recError.textContent = 'Ton navigateur ne permet pas l’enregistrement audio. Essaie avec Safari ou Chrome à jour.';
      recError.classList.add('show');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        mediaStream = stream;
        var mime = pickMime();
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        chunks = [];
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = onRecordingStopped;
        recorder.start(250);

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        drawWave();

        startedAt = Date.now();
        timerId = setInterval(function () {
          var s = (Date.now() - startedAt) / 1000;
          recTimer.textContent = fmt(s);
          if (s >= maxDuration) stopRecording(false);
        }, 250);

        recordBtn.classList.add('recording');
        recIconMic.style.display = 'none';
        recIconStop.style.display = '';
        recHint.textContent = 'Parle… touche le bouton quand tu as fini.';
      })
      .catch(function () {
        recError.textContent = 'Micro inaccessible. Autorise l’accès au micro dans ton navigateur puis réessaie.';
        recError.classList.add('show');
      });
  }

  function cleanupRecording() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (timerId) clearInterval(timerId);
    timerId = null;
    if (audioCtx) { audioCtx.close().catch(function () {}); audioCtx = null; }
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) { t.stop(); });
      mediaStream = null;
    }
    recordBtn.classList.remove('recording');
    recIconMic.style.display = '';
    recIconStop.style.display = 'none';
    drawIdleWave();
  }

  function stopRecording(discard) {
    if (recorder && recorder.state !== 'inactive') {
      recordedDuration = Math.min((Date.now() - startedAt) / 1000, maxDuration);
      if (discard) recorder.onstop = null;
      recorder.stop();
    }
    if (discard) {
      cleanupRecording();
      recTimer.textContent = '0:00';
      recHint.textContent = 'Touche le bouton pour enregistrer.';
    }
  }

  function onRecordingStopped() {
    cleanupRecording();
    if (recordedDuration < 1 || chunks.length === 0) {
      recTimer.textContent = '0:00';
      recError.textContent = 'Message trop court. Réessaie en parlant un peu plus longtemps.';
      recError.classList.add('show');
      return;
    }
    recordedMime = (recorder.mimeType || 'audio/webm').split(';')[0];
    recordedBlob = new Blob(chunks, { type: recordedMime });
    setupPreview();
    show('preview');
  }

  recordBtn.addEventListener('click', function () {
    if (recorder && recorder.state === 'recording') stopRecording(false);
    else startRecording();
  });

  /* ------------------------------------------------------------------ */
  /* Photo optionnelle : choisie sur le téléphone, compressée en local,  */
  /* envoyée uniquement à la validation, verrouillée avec le vocal.      */
  /* ------------------------------------------------------------------ */
  var photoInput = document.getElementById('photoInput');
  var photoBtn = document.getElementById('photoBtn');
  var photoThumb = document.getElementById('photoThumb');
  var photoImg = document.getElementById('photoImg');
  var photoRemove = document.getElementById('photoRemove');
  var photoHint = document.getElementById('photoHint');
  var photoBlob = null;

  photoBtn.addEventListener('click', function () { photoInput.click(); });

  photoInput.addEventListener('change', function () {
    var f = photoInput.files && photoInput.files[0];
    if (!f) return;
    // Redimensionne et compresse en JPEG (max 1600 px) avant tout envoi
    var img = new Image();
    var url = URL.createObjectURL(f);
    img.onload = function () {
      var max = 1600;
      var scale = Math.min(1, max / Math.max(img.width, img.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) {
        URL.revokeObjectURL(url);
        if (!blob) return;
        photoBlob = blob;
        photoImg.src = URL.createObjectURL(blob);
        photoThumb.hidden = false;
        photoHint.hidden = false;
        photoBtn.textContent = 'Changer la photo';
      }, 'image/jpeg', 0.82);
    };
    img.onerror = function () { URL.revokeObjectURL(url); };
    img.src = url;
    photoInput.value = '';
  });

  photoRemove.addEventListener('click', function () {
    photoBlob = null;
    photoImg.src = '';
    photoThumb.hidden = true;
    photoHint.hidden = true;
    photoBtn.textContent = '+ Ajouter une photo (optionnel)';
  });

  /* ------------------------------------------------------------------ */
  /* Étape 3 : réécoute + validation                                    */
  /* ------------------------------------------------------------------ */
  var previewPlay = document.getElementById('previewPlay');
  var previewTime = document.getElementById('previewTime');
  var previewProgress = document.getElementById('previewProgress');
  var uploadError = document.getElementById('uploadError');
  var confirmBtn = document.getElementById('confirmBtn');
  var retryBtn = document.getElementById('retryBtn');
  var previewAudio = null;

  function setupPreview() {
    stopPreview();
    var previewBg = document.getElementById('previewBg');
    if (photoBlob) {
      previewBg.style.backgroundImage = 'url(' + photoImg.src + ')';
      previewBg.classList.add('on');
    } else {
      previewBg.classList.remove('on');
    }
    previewAudio = new Audio(URL.createObjectURL(recordedBlob));
    previewTime.textContent = fmt(recordedDuration);
    previewProgress.style.width = '0%';
    previewAudio.addEventListener('timeupdate', function () {
      previewProgress.style.width = Math.min(100, (previewAudio.currentTime / recordedDuration) * 100) + '%';
      previewTime.textContent = fmt(previewAudio.currentTime) + ' / ' + fmt(recordedDuration);
    });
    previewAudio.addEventListener('ended', function () {
      previewProgress.style.width = '0%';
      previewTime.textContent = fmt(recordedDuration);
    });
  }

  function stopPreview() {
    if (previewAudio) { previewAudio.pause(); previewAudio = null; }
  }

  previewPlay.addEventListener('click', function () {
    if (!previewAudio) return;
    if (previewAudio.paused) previewAudio.play(); else previewAudio.pause();
  });

  retryBtn.addEventListener('click', function () {
    stopPreview();
    recordedBlob = null;
    recTimer.textContent = '0:00';
    recHint.textContent = 'Touche le bouton pour enregistrer.';
    show('record');
  });

  confirmBtn.addEventListener('click', function () {
    if (!recordedBlob || !token) return;
    stopPreview();
    uploadError.classList.remove('show');
    confirmBtn.disabled = true;
    retryBtn.disabled = true;
    confirmBtn.textContent = 'Envoi en cours…';

    // La photo (si présente) part d'abord, puis le vocal finalise le tout
    var sendPhoto = photoBlob
      ? fetch('/api/cards/' + slug + '/photo', {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg', 'Authorization': 'Bearer ' + token },
          body: photoBlob,
        }).then(function (r) {
          if (!r.ok) throw new Error('photo_failed');
        })
      : Promise.resolve();

    sendPhoto
      .then(function () {
        return fetch(
          '/api/cards/' + slug + '/message?duration=' + Math.round(recordedDuration) +
            '&photo=' + (photoBlob ? '1' : '0'),
          {
            method: 'POST',
            headers: { 'Content-Type': recordedMime, 'Authorization': 'Bearer ' + token },
            body: recordedBlob,
          }
        );
      })
      .then(function (r) {
        if (r.ok) { show('done'); return; }
        return r.json().catch(function () { return {}; }).then(function (j) {
          var msg = 'L’envoi a échoué. Vérifie ta connexion puis réessaie.';
          if (r.status === 423) msg = 'Cette carte a déjà un message associé.';
          if (r.status === 401) msg = 'Session expirée : recharge la page et entre à nouveau ton code.';
          uploadError.textContent = msg;
          uploadError.classList.add('show');
        });
      })
      .catch(function () {
        uploadError.textContent = 'L’envoi a échoué. Vérifie ta connexion puis réessaie.';
        uploadError.classList.add('show');
      })
      .finally(function () {
        confirmBtn.disabled = false;
        retryBtn.disabled = false;
        confirmBtn.textContent = 'Valider et associer à la carte';
      });
  });

  show('activate');
})();
