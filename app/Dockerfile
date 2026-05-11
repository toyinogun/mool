FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY db ./db
COPY drizzle.config.ts ./

RUN chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "src/server.ts"]
