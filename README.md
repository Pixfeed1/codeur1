# ravive — web-app NFC de souvenirs vocaux (MVP)

Chaque carte NFC encode une URL unique (`https://votre-domaine.fr/c/<identifiant>`).

- **Acheteur** : scan → entre le code d'activation (caché dans le packaging) →
  enregistre son message vocal → réécoute / recommence → valide.
  Le vocal est alors **associé définitivement** à la carte.
- **Destinataire** : scan → « Une voix t'attend » → écoute. C'est tout.

Aucune application à installer : tout passe par le navigateur du téléphone
(micro via l'API MediaRecorder, compatible iPhone/Safari et Android/Chrome).

## Stack

- **Node.js ≥ 20** + Express — serveur et API (4 routes)
- **SQLite** (better-sqlite3) — la base = un fichier dans `data/`, sauvegarde triviale
- Audios stockés sur disque dans `data/audio/`
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
les codes sont irrécupérables — regénérer des cartes.

## Configuration (`.env` à la racine, tout est optionnel)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `BASE_URL` | `http://localhost:3000` | Domaine public, utilisé pour les URL du CSV |
| `SECRET` | auto-généré dans `data/.secret` | Signe les jetons et sale les codes. **Ne pas le changer après la mise en prod** (les codes déjà imprimés deviendraient invalides) |
| `ADMIN_TOKEN` | désactivé | Active `GET /api/admin/cards` (état des cartes) avec `Authorization: Bearer <token>` |
| `MAX_DURATION_S` | `180` | Durée max d'un vocal (secondes) |
| `MAX_UPLOAD_BYTES` | `26214400` | Taille max d'upload (25 Mo) |

## Déploiement sur un VPS (EX2, Ubuntu 24.04)

Prévu pour la plus petite offre VPS (1 vCPU / 2 Go suffisent largement).

```bash
# 1. Prérequis
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm install -g pm2

# 2. Application
sudo mkdir -p /var/www/ravive && sudo chown $USER /var/www/ravive
git clone <repo> /var/www/ravive && cd /var/www/ravive
npm ci --omit=dev
echo "BASE_URL=https://votre-domaine.fr" > .env

# 3. Process manager (redémarre l'app en cas de crash ou de reboot)
pm2 start server.js --name ravive
pm2 save && pm2 startup   # suivre l'instruction affichée

# 4. Nginx en reverse proxy
sudo tee /etc/nginx/sites-available/ravive <<'CONF'
server {
    listen 80;
    server_name votre-domaine.fr;
    client_max_body_size 30m;      # uploads audio
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
CONF
sudo ln -s /etc/nginx/sites-available/ravive /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 5. HTTPS (obligatoire : le micro n'est accessible qu'en HTTPS)
sudo certbot --nginx -d votre-domaine.fr   # renouvellement automatique inclus
```

> **Important** : sans HTTPS, les navigateurs bloquent l'accès au micro.
> Certbot/Let's Encrypt est gratuit et se renouvelle tout seul.

### Sauvegardes

Tout est dans `/var/www/ravive/data`. Exemple de sauvegarde quotidienne :

```bash
crontab -e
# 0 3 * * * tar czf /var/backups/ravive-$(date +\%u).tar.gz -C /var/www/ravive data
```

(7 archives tournantes, une par jour de la semaine. Penser à les copier
hors du serveur régulièrement.)

### Mise à jour de l'app

```bash
cd /var/www/ravive && git pull && npm ci --omit=dev && pm2 restart ravive
```

## Production d'un lot de cartes (résumé du flux)

1. Sur le serveur : `node scripts/generate-cards.js 200`
2. Récupérer le CSV dans `data/exports/`
3. Encoder chaque URL dans la puce de la carte correspondante (NDEF, type URI)
4. Imprimer le code d'activation dans le packaging de la même carte
5. Supprimer le CSV une fois le lot produit (il contient les codes en clair)

## Sécurité (résumé)

- Codes d'activation : 6 caractères sans ambiguïté (~1 milliard de combinaisons),
  stockés en empreinte HMAC, jamais en clair ; 5 essais max / 15 min par carte et par IP.
- Upload : uniquement avec un jeton signé délivré après validation du code, expirant après 1 h.
- Verrouillage : l'association vocal ↔ carte est atomique en base ; une carte
  enregistrée ne peut plus jamais être modifiée par l'API.
- Les pages cartes sont en `noindex` (pas d'indexation des URLs privées).

## Évolutions prévues (hors MVP)

- Photos et vidéos en plus de l'audio (même mécanique d'upload lié au slug)
- Tableau de bord d'administration (l'API `GET /api/admin/cards` existe déjà)
- Migration SQLite → PostgreSQL si le volume l'exige un jour (couche données isolée dans `src/db.js`)
