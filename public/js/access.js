'use strict';

/* ravive — page « lien perdu » de l'organisateur */

(function () {
  var f = document.getElementById('f'), err = document.getElementById('err'), ok = document.getElementById('ok'), btn = document.getElementById('send');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    err.classList.remove('show');
    btn.disabled = true;
    window.RV.api('POST', '/api/access', { body: { email: document.getElementById('email').value } })
      .then(function () { ok.classList.remove('hidden'); f.classList.add('hidden'); })
      .catch(function (x) {
        err.textContent = x.message === 'too_many_requests' ? 'Trop de demandes, réessaie dans quelques minutes.' : x.message === 'invalid_email' ? 'Vérifie le format de l’adresse.' : 'Une erreur est survenue, réessaie.';
        err.classList.add('show');
        btn.disabled = false;
      });
  });
})();
