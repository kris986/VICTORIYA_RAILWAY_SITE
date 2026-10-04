FROM node:24-alpine

WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node public ./public

ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
