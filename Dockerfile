# ravive — image de production minimale.
# Rend l'app portable telle quelle : dédié, VPS, ou n'importe quel hôte Docker.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# better-sqlite3 fournit des binaires précompilés pour linux x64/arm64 ;
# aucune chaîne de compilation n'est nécessaire dans l'image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p /app/data && chown -R node:node /app/data

# Toutes les données (SQLite, audios, secret, exports) vivent dans /app/data :
# monter un volume dessus, c'est tout ce qu'il y a à sauvegarder/migrer.
VOLUME /app/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

USER node
CMD ["node", "server.js"]
