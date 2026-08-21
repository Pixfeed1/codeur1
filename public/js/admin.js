'use strict';

/* ravive — administration : génération des lots et suivi des cartes */

(function () {
  var token = sessionStorage.getItem('ravive_admin') || '';
  var lastBatch = null;

  var loginScreen = document.getElementById('loginScreen');
  var dashScreen = document.getElementById('dashScreen');
  var loginForm = document.getElementById('loginForm');
  var loginError = document.getElementById('loginError');

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: Object.assign(
        { 'Authorization': 'Bearer ' + token },
        body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 401) throw new Error('unauthorized');
      if (!r.ok) throw new Error('http_' + r.status);
      return r.json();
    });
  }

  function fmtDate(s) {
    return s ? s.replace('T', ' ').slice(0, 16) : '—';
  }

  function refresh() {
    return api('GET', '/api/admin/cards').then(function (data) {
      var cards = data.cards;
      document.getElementById('statTotal').textContent = cards.length;
      document.getElementById('statPending').textContent =
        cards.filter(function (c) { return c.status === 'pending'; }).length;
      document.getElementById('statRecorded').textContent =
        cards.filter(function (c) { return c.status === 'recorded'; }).length;

      var body = document.getElementById('cardsBody');
      body.innerHTML = '';
      cards.forEach(function (c) {
        var tr = document.createElement('tr');
        var url = data.baseUrl + '/c/' + c.slug;
        tr.innerHTML =
          '<td class="mono"><a href="' + url + '" target="_blank" rel="noopener">' + url + '</a></td>' +
          '<td><span class="tag ' + c.status + '">' +
            (c.status === 'recorded' ? 'enregistrée' : 'en attente') + '</span></td>' +
          '<td>' + (c.duration_s ? Math.round(c.duration_s) + ' s' : '—') + '</td>' +
          '<td>' + (c.has_photo ? 'oui' : '—') + '</td>' +
          '<td>' + fmtDate(c.created_at) + '</td>' +
          '<td>' + fmtDate(c.recorded_at) + '</td>';
        body.appendChild(tr);
      });
    });
  }

  function showDash() {
    loginScreen.classList.remove('active');
    dashScreen.classList.add('active');
  }

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    loginError.classList.remove('show');
    token = document.getElementById('user').value + ':' + document.getElementById('pass').value;
    refresh()
      .then(function () {
        sessionStorage.setItem('ravive_admin', token);
        showDash();
      })
      .catch(function (err) {
        token = '';
        loginError.textContent = err.message === 'unauthorized'
          ? 'Identifiant ou mot de passe incorrect.'
          : 'Erreur de connexion au serveur.';
        loginError.classList.add('show');
      });
  });

  // Session déjà ouverte dans cet onglet
  if (token) {
    refresh().then(showDash).catch(function () {
      token = '';
      sessionStorage.removeItem('ravive_admin');
    });
  }

  document.getElementById('generateBtn').addEventListener('click', function () {
    var count = Number(document.getElementById('batchCount').value);
    if (!count || count < 1 || count > 1000) return;
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Génération…';
    api('POST', '/api/admin/cards', { count: count })
      .then(function (data) {
        lastBatch = data.cards;
        document.getElementById('batchResult').style.display = '';
        return refresh();
      })
      .catch(function () { alert('La génération a échoué. Réessaie.'); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Générer les cartes';
      });
  });

  document.getElementById('downloadCsv').addEventListener('click', function () {
    if (!lastBatch) return;
    var csv = 'url_nfc;code_activation\n' + lastBatch
      .map(function (c) { return c.url + ';' + c.code; })
      .join('\n') + '\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'cartes-ravive-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });
})();
