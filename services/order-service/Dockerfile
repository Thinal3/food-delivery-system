FROM node:22.14.0-alpine

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .
RUN chmod 755 docker-entrypoint.sh

USER node
EXPOSE 5003
CMD ["./docker-entrypoint.sh"]
