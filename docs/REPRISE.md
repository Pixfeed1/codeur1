# Ravive V1 cadres — note de reprise

Point de situation au 26 septembre 2026, pour reprendre le travail dans une nouvelle session.

## Contexte
- Client : Ravive (Emilien / Clara Grange), via Codeur. Devis 3 900 € HT en 3 lots, tous réglés (lot 3 viré le 14 septembre, mise en production datée du 14 septembre). Support gratuit (bugs, corrections sur l'existant) jusqu'au 25 octobre 2026.
- V1.1 (1 400 € HT) : livrée et en ligne chez le client depuis le 14 septembre, facturée (F-2026-0179), réglée le 25 septembre. Voir `docs/V1.1.md`.
- Bascule de domaine (24-25 septembre, 80 € HT à facturer à part) : `ravive-moi.fr` et `www` pointent sur Shopify (A 23.227.38.65, CNAME shops.myshopify.com), l'appli est sur **https://app.ravive-moi.fr** (bloc nginx `ravive-app`, certificat Let's Encrypt propre, `BASE_URL` du `.env` mis à jour, webhook Shopify repointé). Reste côté Shopify : définir ravive-moi.fr comme domaine principal, puis commande test Bogus. Reste côté serveur, une fois la boutique visible sur ravive-moi.fr : `rm /etc/nginx/sites-enabled/ravive`, `nginx -t && systemctl reload nginx`, `certbot delete --cert-name ravive-moi.fr` (l'ancien certificat ne pourra plus se renouveler).
- Export ZIP d'un projet (26 septembre, demande client, inclus sans frais) : dossier `cadre/` avec la composition finale, `composition.svg` (photos incorporées) et `composition.png` (300 dpi, 2126 x 2835 px pour 18 x 24 cm), généré par `src/compose.js` (sharp + librsvg). Bouton « Télécharger la composition » dans la fiche projet de l'admin. Le rendu du petit mot dépend d'une police système : vérifier `fc-list` sur le serveur, sinon `apt install -y fonts-dejavu-core`.
- Branche de travail : `claude/ravive-project-quote-5cmhkv` (ne pas pousser ailleurs sans accord). Tout est commité et poussé.
- Serveur du client : `ssh root@app.ravive-moi.fr` (l'ancien nom mène désormais à Shopify), appli dans `/home/ravive/ravive-app`, service systemd `ravive`, logs dans `app.log` (pas journalctl).
  Mise à jour : `cd /home/ravive/ravive-app && sudo -u ravive git pull -q && systemctl restart ravive`
  Données de démo : `sudo -u ravive node scripts/seed-demo.js --reset`
- Serveur PixFeed (démo, cPanel/Apache) : ravive.pixfeed.net, `/home/jurojinn/ravive-app`, port 4010, `journalctl -u ravive -f`. Héberge encore les cartes postales de démo (puces NFC du client écrites avec ces liens). À éteindre le vendredi 18 septembre, accord du client reçu ; les cartes se créent désormais sur ravive-moi.fr.
- Shopify branché (webhook, 5 produits avec SKU RAVIVE-10/25/50/100/EXTRA), Brevo branché, ffmpeg installé chez le client.
- Admin : https://app.ravive-moi.fr/admin (identifiants dans le `.env` du serveur).

## Fait pendant la recette (8 septembre)
- Recette automatisée Playwright (scratchpad, 104 captures iPhone 13 / SE) : corrections de reprise après rechargement, petits écrans, textes longs.
- Retours client corrigés : cadrage photo, vocal 60 s, vocaux dans les stories (faux sons dans la démo + lecteur unique déverrouillé), composition organisateur (ordre, défilement conservé, recadrage des photos ajoutées), fenêtre de validation avant scellement, question « tu es… ? » retirée, libellé « lien perdu ».
- Parcours destinataire refait d'après la maquette v3 du client.

## Finitions incluses (faites le 9 septembre), d'après `Idées ravive.pdf` du client
1. Textes contributeur : kicker « Commençons par toi » (écran prénom), « À toi de jouer 📷 » à la place de « Ajoute une photo de toi ».
2. Compte à rebours réel sur l'invitation : « 7 jours · 06 h · 24 min », mis à jour chaque minute, capsule et sablier conservés (`public/js/contribute.js`, écran `invite`, champ `deadline` fourni par l'API).
3. Animations d'accueil (CSS) : titre fondu + translateY 10→0 (400 ms), cœur mini pop une fois, image fondu + scale .96→1 (500 ms), les 3 blocs en cascade (350 ms, décalage 120 ms). Bouton : scale 1→.98→1 au toucher. Transition standard entre écrans contributeur : nouvel écran arrive du bas en fondu (300 ms).
4. Écran prénom : fondu à l'arrivée, mini pop de l'icône appareil photo, effet scale .92→1.03→1 quand la photo remplace l'icône.
5. Carte-question : « Une autre question » ne rerend que la carte (ancienne glisse à gauche + fondu, nouvelle arrive de droite), 250-300 ms.
6. Écran de fin contributeur (« merci ») plus marquant : animation signature discrète.
7. Reveal destinataire : question plus grande et plus centrale (`.mkick` dans `public/js/recipient.js` et `public/css/ravive.css`).
Toutes faites, testées (captures iPhone 13) et poussées.

## Charte
Couleurs des maquettes finales appliquées le 14 septembre (chocolat sur les boutons, terracotta en accent, commit 0687320), offertes.

## Avenant proposé au client (600 € HT), repris dans la V1.1 (`docs/V1.1.md`)
- 4 univers de questions avec couleurs : Dossiers & délires #F4C95D, Ce qu'on ressent #E98273, Vos souvenirs #82B9D8, Et après ? #A99BD4 (aujourd'hui 5 catégories : dire, souv, dossier, nous, devant, dans `src/schema.js` et l'admin). Couleur sur le titre de catégorie et teinte légère de la carte, fond crème conservé.
- Icônes Ravive en trait fin (onde, crayon, contour photo) à la place des emojis des 3 boutons de réponse.
- Forme d'onde qui suit vraiment la voix (Web Audio AnalyserNode sur le lecteur partagé `RV.audioPlayer`), à valider sur iPhone.
- Animation signature à l'ouverture du parcours destinataire (pas de vibration ni de son possible sans geste sur iOS).

## Reste pour la mise en production
- Mentions légales et politique de confidentialité (`views/mentions-legales.html`, `views/confidentialite.html`) : attendre le SIRET du client.
- Relier le domaine de la boutique Shopify et mettre « URL de la boutique » dans l'admin (Réglages) ; identifiant de variante places supplémentaires déjà renseigné (54885649154389).
- Tests sur vrais téléphones (iPhone Safari : micro, photo, lecture auto des vocaux).
- Attendre du client : SIRET (mentions légales) et adresse définitive de la boutique Shopify (demandés le 14 septembre).
- Cartes postales : bug signalé sur le téléphone d'Émilien (enregistrement qui ne démarre pas) ; serveur vérifié OK, lecture OK sur iPhone ; en attente de son test (Safari direct, réglage micro).
- Option vidéo (600 € HT) refusée par le client pour la V1.
