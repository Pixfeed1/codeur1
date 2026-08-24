# ravive - web-app NFC de souvenirs vocaux (MVP)

Chaque carte NFC encode une URL unique (`https://votre-domaine.fr/c/<identifiant>`).

- **Acheteur** : scan → entre le code d'activation (caché dans le packaging) →
  enregistre son message vocal → réécoute / recommence → valide.
  Le vocal est alors **associé définitivement** à la carte.
- **Destinataire** : scan → « Une voix t'attend » → écoute. C'est tout.

Aucune application à installer : tout passe par le navigateur du téléphone
(micro via l'API MediaRecorder, compatible iPhone/Safari et Android/Chrome).

## Stack

- **Node.js ≥ 20** + Express : serveur et API (4 routes)
- **SQLite** (better-sqlite3) : la base est un simple fichier dans `data/`, sauvegarde triviale
- Audios et photos stockés sur disque dans `data/audio/` et `data/photos/`
- Front HTML/CSS/JS pur, aucun framework, aucune dépendance front

Toutes les données vivent dans `data/` (créé automatiquement) : **sauvegarder ce
dossier = sauvegarder tout le service**.

## Lancer en local

```bash
npm install
npm start            # http://localhost:3000
```

Générer des cartes de test :

```bash
node scripts/generate-cards.js 5
```

Le script affiche un CSV `url_nfc;code_activation` et l'enregistre dans
`data/exports/`. C'est ce fichier qu'on transmet à l'encodeur NFC (colonne URL)
et à l'imprimeur du packaging (colonne code). Les codes ne sont **jamais**
stockés en clair en base (empreinte HMAC uniquement) : si le CSV est perdu,
les codes sont irrécupérables et il faut regénérer des cartes.

## Portabilité : conçu pour changer de serveur facilement

Le principe : **l'application est jetable, seul le dossier `data/` compte.**
Il contient la base SQLite, les fichiers audio, le secret de signature
(`data/.secret`) et les exports CSV. Aucune donnée n'est stockée ailleurs,
aucune dépendance à un service externe (pas de BDD séparée, pas de cloud).

Bascule d'un serveur A (ex. dédié perso) vers un serveur B (ex. VPS) :

```bash
# Sur A : arrêter l'app puis archiver l'état
systemctl stop ravive
tar czf ravive-data.tar.gz -C /home/ravive/ravive-app data

# Sur B : installer l'app (voir section déploiement), puis restaurer
scp ravive-data.tar.gz serveurB:/home/ravive/ravive-app/
tar xzf ravive-data.tar.gz -C /home/ravive/ravive-app
chown -R ravive:ravive /home/ravive/ravive-app/data
systemctl start ravive
```

Puis pointer le DNS du domaine vers le serveur B. Les URLs des cartes NFC ne
changent pas (même domaine), les codes déjà imprimés restent valides (le
secret voyage dans `data/.secret`). Interruption de service : le temps de la
copie + propagation DNS.

À savoir :
- `DATA_DIR` (variable d'env) permet de placer `data/` où l'on veut.
- `npm ci` recompile ou retélécharge le binaire SQLite adapté au nouveau serveur :
  ne jamais copier `node_modules` d'une machine à l'autre.
- Une image **Docker** est fournie (`Dockerfile` + `docker-compose.yml`) : sur un
  hôte avec Docker, `docker compose up -d` suffit, et la migration se résume au
  même transfert du dossier `data/`.
- Derrière un reverse proxy, mettre `TRUST_PROXY=1` (sinon l'anti-bruteforce
  verrait tous les visiteurs derrière l'IP du proxy).
- `GET /healthz` répond `{"ok":true}` pour la supervision.

## Configuration (`.env` à la racine, tout est optionnel)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `TRUST_PROXY` | `0` | Mettre `1` derrière Nginx/Caddy (vraie IP client pour l'anti-bruteforce) |
| `DATA_DIR` | `./data` | Emplacement des données (base, audios, secret) |
| `BASE_URL` | `http://localhost:3000` | Domaine public, utilisé pour les URL du CSV |
| `SECRET` | auto-généré dans `data/.secret` | Signe les jetons et sale les codes. **Ne pas le changer après la mise en prod** (les codes déjà imprimés deviendraient invalides) |
| `ADMIN_USER` / `ADMIN_TOKEN` | désactivé | Identifiant + mot de passe de la page d'administration `/admin` (les deux requis) |
| `MAX_DURATION_S` | `180` | Durée max d'un vocal (secondes) |
| `MAX_UPLOAD_BYTES` | `26214400` | Taille max d'upload (25 Mo) |

## Déploiement sur un VPS (EX2, Ubuntu 24.04)

Prévu pour la plus petite offre VPS (1 vCPU / 2 Go suffisent largement).

```bash
# 1. Prérequis (en root)
apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx git ufw build-essential sqlite3
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs

# 2. Pare-feu (SSH d'abord, sinon on se coupe l'accès)
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable

# 3. Utilisateur dédié et application
adduser --disabled-password --gecos "" ravive
su - ravive -c 'git clone <repo> ravive-app'
su - ravive -c 'cd ravive-app && npm ci --omit=dev'

cat > /home/ravive/ravive-app/.env <<'ENV'
BASE_URL=https://votre-domaine.fr
TRUST_PROXY=1
PORT=3000
ADMIN_USER=identifiant-admin
ADMIN_TOKEN=mot-de-passe-solide
ENV
chown ravive:ravive /home/ravive/ravive-app/.env

# 4. Service systemd (démarre au boot, redémarre après incident)
cat > /etc/systemd/system/ravive.service <<'UNIT'
[Unit]
Description=Ravive NFC Voice Messages Application
After=network.target

[Service]
Type=simple
User=ravive
Group=ravive
WorkingDirectory=/home/ravive/ravive-app
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=append:/home/ravive/ravive-app/app.log
StandardError=append:/home/ravive/ravive-app/app.log

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now ravive
curl -s http://127.0.0.1:3000/healthz    # doit répondre {"ok":true}

# 5. Nginx en reverse proxy
cat > /etc/nginx/sites-available/ravive <<'CONF'
server {
    listen 80;
    server_name votre-domaine.fr;
    client_max_body_size 30m;      # uploads audio et photo
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
CONF
ln -sf /etc/nginx/sites-available/ravive /etc/nginx/sites-enabled/ravive
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 6. HTTPS (obligatoire : le micro n'est accessible qu'en HTTPS)
# Vérifier d'abord que le domaine pointe vers ce serveur :
#   getent hosts votre-domaine.fr
certbot --nginx -d votre-domaine.fr --redirect   # renouvellement automatique inclus

# 7. Recette : tout doit être vert
APP_DIR=/home/ravive/ravive-app SERVICE=ravive \
  bash /home/ravive/ravive-app/scripts/check-deploy.sh votre-domaine.fr
```

Le module SQLite est compilé à l'installation : sans `build-essential`, le
`npm ci` échoue avec `not found: make`. Et si le service ne démarre pas
(erreur SEGV), c'est presque toujours que le `node` de l'`ExecStart` n'est pas
celui qui a installé les modules : les deux doivent être le même binaire.

> **Important** : sans HTTPS, les navigateurs bloquent l'accès au micro.
> Certbot/Let's Encrypt est gratuit et se renouvelle tout seul.

### Sauvegardes

Tout l'état vit dans le dossier `data/` de l'application. Le script
`scripts/backup.sh` en fait un snapshot quotidien :

```bash
# une fois, pour programmer la sauvegarde de 3h du matin
(crontab -l 2>/dev/null; echo "0 3 * * * APP_DIR=/home/ravive/ravive-app bash /home/ravive/ravive-app/scripts/backup.sh >> /var/log/ravive-backup.log 2>&1") | crontab -
```

Chaque jour a son dossier complet dans `/var/backups/ravive/AAAA-MM-JJ`, mais
les fichiers inchangés d'un jour à l'autre (un message vocal scellé ne bouge
plus jamais) sont partagés par liens durs au lieu d'être dupliqués. Sept jours
d'historique coûtent donc à peine plus qu'une seule copie des données, là où
sept archives complètes en auraient coûté sept fois le volume. La base SQLite
est copiée avec `sqlite3 .backup`, donc cohérente même si l'application écrit
pendant la sauvegarde.

Variables : `KEEP` (jours conservés, 7 par défaut), `DEST` (destination).
Le script alerte dans le log si le disque dépasse 85 %.

Restauration : arrêter le service, copier le contenu d'un dossier de snapshot
dans `data/`, redémarrer.

> Ces snapshots sont sur le même serveur : ils protègent d'une erreur
> applicative ou d'une suppression, pas d'une perte du serveur. Copier
> régulièrement un snapshot hors du serveur (l'hébergeur fournit par ailleurs
> ses propres sauvegardes quotidiennes de la machine).

### Mise à jour de l'app

```bash
su - ravive -c 'cd ravive-app && git pull && npm ci --omit=dev'
systemctl restart ravive
```

## Administration des cartes (interface web)

Une page d'administration existe sur `/admin`, protégée par mot de passe :

1. Définir l'identifiant et le mot de passe dans le `.env` :
   `ADMIN_USER=...` et `ADMIN_TOKEN=un-mot-de-passe-solide`
   (sans ces deux variables, la page et l'API d'admin sont désactivées), puis
   redémarrer l'application.
2. Ouvrir `https://votre-domaine.fr/admin` → entrer l'identifiant et le mot de passe.
3. Depuis la page : générer un lot de cartes (le CSV `URL ; code` se télécharge
   dans le navigateur, les codes ne sont affichés qu'une seule fois), et suivre
   l'état de toutes les cartes (en attente / enregistrée, durée, dates).

## Production d'un lot de cartes (résumé du flux)

1. Générer le lot depuis `/admin` (ou en SSH : `node scripts/generate-cards.js 200`,
   CSV dans `data/exports/`)
2. Encoder chaque URL dans la puce de la carte correspondante (NDEF, type URI)
3. Imprimer le code d'activation dans le packaging de la même carte
4. Supprimer le fichier CSV une fois le lot produit (il contient les codes en clair)

## Sécurité (résumé)

- Codes d'activation : 6 caractères sans ambiguïté (~1 milliard de combinaisons),
  stockés en empreinte HMAC, jamais en clair ; 5 essais max / 15 min par carte et par IP.
- Upload : uniquement avec un jeton signé délivré après validation du code, expirant après 1 h.
- Verrouillage : l'association vocal ↔ carte est atomique en base ; une carte
  enregistrée ne peut plus jamais être modifiée par l'API.
- Les pages cartes sont en `noindex` (pas d'indexation des URLs privées).

## Évolutions possibles

- Vidéo en plus du vocal et de la photo (même mécanique d'upload liée au slug)
- Statistiques d'usage (nombre d'écoutes par carte, délai moyen entre scellage et écoute)
- Migration SQLite → PostgreSQL si le volume l'exige un jour (couche données isolée dans `src/db.js`)
