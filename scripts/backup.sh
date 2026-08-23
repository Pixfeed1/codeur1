#!/bin/bash
# Sauvegarde quotidienne de ravive.
#
# Snapshots par liens durs : chaque jour a son dossier complet, mais les
# fichiers inchangés (un vocal scellé ne bouge plus) ne sont pas dupliqués.
# 7 jours d'historique coûtent donc à peine plus qu'une seule copie.
#
#   bash scripts/backup.sh
# Variables : APP_DIR, DEST, KEEP (nombre de jours conservés)

set -u

APP_DIR="${APP_DIR:-/home/ravive/ravive-app}"
DEST="${DEST:-/var/backups/ravive}"
KEEP="${KEEP:-7}"
DAY=$(date +%F)

[ -d "$APP_DIR/data" ] || { echo "données introuvables : $APP_DIR/data"; exit 1; }
mkdir -p "$DEST"

# Snapshot du jour, lié au précédent pour ne stocker que les nouveautés
PREV=$(ls -1d "$DEST"/20*/ 2>/dev/null | grep -v "/$DAY/$" | tail -1)
LINK=""
[ -n "$PREV" ] && LINK="--link-dest=${PREV%/}"

# Miroir des contenus (audio, photos, secret). La base est traitée à part
# juste après, on l'exclut donc ici.
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude 'ravive.db*' $LINK "$APP_DIR/data/" "$DEST/$DAY/"
else
  # Sans rsync : mêmes snapshots par liens durs, en cp/find
  rm -rf "${DEST:?}/$DAY"
  if [ -n "$PREV" ]; then cp -al "${PREV%/}" "$DEST/$DAY"; else mkdir -p "$DEST/$DAY"; fi
  (cd "$APP_DIR/data" && find . -type f ! -name 'ravive.db*' -print0) |
    while IFS= read -r -d '' f; do
      mkdir -p "$DEST/$DAY/$(dirname "$f")"
      if [ ! -e "$DEST/$DAY/$f" ] || [ "$APP_DIR/data/$f" -nt "$DEST/$DAY/$f" ]; then
        cp -a --remove-destination "$APP_DIR/data/$f" "$DEST/$DAY/$f"
      fi
    done
  (cd "$DEST/$DAY" && find . -type f -print0) |
    while IFS= read -r -d '' f; do
      [ -e "$APP_DIR/data/$f" ] || rm -f "$DEST/$DAY/$f"
    done
fi

# Base SQLite : copie cohérente même pendant que l'application écrit
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$APP_DIR/data/ravive.db" ".backup '$DEST/$DAY/ravive.db'"
else
  # Sans l'outil sqlite3 : copie brute de la base et de son journal
  cp --remove-destination "$APP_DIR/data/ravive.db"* "$DEST/$DAY/" 2>/dev/null
fi

# Rotation : on ne garde que les KEEP derniers jours
ls -1d "$DEST"/20*/ 2>/dev/null | head -n -"$KEEP" | xargs -r rm -rf

# Alerte si le disque se remplit
USE=$(df --output=pcent "$DEST" 2>/dev/null | tail -1 | tr -dc 0-9)
if [ -n "$USE" ] && [ "$USE" -ge 85 ]; then
  echo "ALERTE ravive : disque à ${USE}% sur $(hostname) — augmenter l'offre ou réduire KEEP"
fi

echo "$(date +'%F %T') sauvegarde OK — $(du -sh "$DEST" 2>/dev/null | cut -f1) occupés par $(ls -1d "$DEST"/20*/ 2>/dev/null | wc -l) jour(s) d'historique"
