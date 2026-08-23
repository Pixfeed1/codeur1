#!/bin/bash
# Vérification du déploiement ravive — à lancer en root sur le serveur :
#   bash scripts/check-deploy.sh [domaine]
# Teste toute la chaîne : service systemd → app → proxy → HTTP → HTTPS.
# Chaque échec affiche la commande de diagnostic ou de correction.

APP_DIR="${APP_DIR:-/home/jurojinn/ravive-app}"
DOMAIN="${1:-ravive.pixfeed.net}"
SERVICE="${SERVICE:-ravive}"

PORT=$(grep -s '^PORT=' "$APP_DIR/.env" | cut -d= -f2)
PORT="${PORT:-3000}"

ok=0; ko=0
pass() { echo "  ✅ $1"; ok=$((ok+1)); }
fail() { echo "  ❌ $1"; echo "     → $2"; ko=$((ko+1)); }

echo "=== Vérification ravive — $DOMAIN (port $PORT) ==="
echo

echo "[1] Fichiers de l'application"
[ -f "$APP_DIR/server.js" ] \
  && pass "code présent dans $APP_DIR" \
  || fail "server.js introuvable dans $APP_DIR" "vérifier le chemin (variable APP_DIR)"
[ -f "$APP_DIR/.env" ] \
  && pass ".env présent (PORT=$PORT)" \
  || fail ".env manquant" "créer $APP_DIR/.env avec BASE_URL, TRUST_PROXY=1, PORT"
[ -d "$APP_DIR/node_modules" ] \
  && pass "node_modules installé" \
  || fail "node_modules manquant" "cd $APP_DIR && npm ci --omit=dev (avec le node de l'ExecStart !)"

echo
echo "[2] Service systemd"
EXEC=$(systemctl show -p ExecStart --value "$SERVICE" 2>/dev/null | grep -o 'path=[^ ;]*' | head -1 | cut -d= -f2)
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  pass "service $SERVICE actif (ExecStart: ${EXEC:-?})"
else
  fail "service $SERVICE inactif ou en échec" "journalctl -u $SERVICE -n 30 ; tail -30 $APP_DIR/app.log"
fi
if [ -n "$EXEC" ] && [ -x "$EXEC" ]; then
  NV=$("$EXEC" --version 2>/dev/null)
  case "$NV" in
    v2[0-9]*|v[3-9][0-9]*) pass "binaire node du service : $EXEC ($NV)" ;;
    v*) fail "node du service trop ancien ($NV)" "pointer ExecStart vers un node >= 20 (ex. /opt/cpanel/ea-nodejs22/bin/node)" ;;
    *) : ;; # ExecStart ne pointe pas sur node (npm...) : le test [3] tranchera
  esac
fi

echo
echo "[3] Application"
if ss -tln 2>/dev/null | grep -q ":$PORT "; then
  pass "un process écoute sur le port $PORT"
else
  fail "rien n'écoute sur le port $PORT" "systemctl restart $SERVICE puis journalctl -u $SERVICE -n 30"
fi
LOCAL=$(curl -s -m 5 "http://127.0.0.1:$PORT/healthz")
[ "$LOCAL" = '{"ok":true}' ] \
  && pass "l'app répond en local (healthz)" \
  || fail "pas de réponse healthz en local (reçu : ${LOCAL:-rien})" "tail -30 $APP_DIR/app.log"

echo
echo "[4] Reverse proxy (Nginx ou Apache/cPanel)"
NGINX_CONF=$(grep -rsl "server_name.*$DOMAIN" /etc/nginx/sites-enabled/ 2>/dev/null | head -1)
if [ -n "$NGINX_CONF" ]; then
  grep -q "127.0.0.1:$PORT" "$NGINX_CONF" \
    && pass "conf Nginx présente ($NGINX_CONF) vers le port $PORT" \
    || fail "la conf Nginx $NGINX_CONF ne pointe pas le port $PORT" "corriger proxy_pass puis nginx -t && systemctl reload nginx"
else
  FOUND=0
  for f in std ssl; do
    CONF=$(grep -rsl "ProxyPass / http://127.0.0.1:$PORT/" "/etc/apache2/conf.d/userdata/$f/2_4/" 2>/dev/null | grep "$DOMAIN")
    [ -n "$CONF" ] && FOUND=$((FOUND+1))
  done
  [ "$FOUND" -ge 2 ] \
    && pass "conf proxy Apache présente (std + ssl) vers le port $PORT" \
    || fail "aucune conf de reverse proxy trouvée pour $DOMAIN" "créer le vhost Nginx, ou les proxy.conf cPanel puis rebuildhttpdconf"
fi

# -L : suit la redirection HTTP -> HTTPS mise en place par certbot
HTTP=$(curl -sL -m 8 "http://$DOMAIN/healthz")
[ "$HTTP" = '{"ok":true}' ] \
  && pass "le domaine répond en HTTP (redirection HTTPS suivie)" \
  || fail "le domaine ne joint pas l'app en HTTP (reçu : ${HTTP:0:60})" "vérifier le reverse proxy et que le DNS pointe ce serveur"

echo
echo "[5] HTTPS (obligatoire pour le micro)"
HTTPS=$(curl -s -m 8 "https://$DOMAIN/healthz")
if [ "$HTTPS" = '{"ok":true}' ]; then
  EXP=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  pass "HTTPS opérationnel (certificat expire : ${EXP:-?})"
else
  fail "HTTPS KO (reçu : ${HTTPS:0:60})" "certbot --nginx -d $DOMAIN --redirect (ou AutoSSL sous cPanel), puis relancer ce script"
fi

echo
echo "[6] Données"
if [ -d "$APP_DIR/data" ]; then
  OWNER=$(stat -c %U "$APP_DIR/data")
  SVCUSER=$(systemctl show -p User --value "$SERVICE" 2>/dev/null)
  [ "$OWNER" = "${SVCUSER:-$OWNER}" ] \
    && pass "dossier data/ présent (propriétaire : $OWNER)" \
    || fail "data/ appartient à $OWNER mais le service tourne en $SVCUSER" "chown -R $SVCUSER: $APP_DIR/data"
  N=$(ls "$APP_DIR"/data/exports/*.csv 2>/dev/null | wc -l)
  [ "$N" -gt 0 ] && echo "  ⚠ $N export(s) CSV avec codes en clair dans data/exports/ — à supprimer après usage"
else
  fail "dossier data/ absent" "il se crée au premier lancement de l'app — voir le test [3]"
fi

echo
echo "=== Résultat : $ok OK, $ko problème(s) ==="
if [ "$ko" -eq 0 ]; then
  echo "Chaîne serveur entièrement fonctionnelle."
  echo "Dernier test (manuel, sur téléphone) : ouvrir une URL de carte en HTTPS,"
  echo "entrer le code, enregistrer, valider, re-scanner, écouter."
fi
exit "$ko"
