FROM node:20-alpine

# better-sqlite3 compiles a native addon during install. The build needs
# python3 + a C++ toolchain. We install them, run npm ci, then drop the
# build packages to keep the runtime image small.
WORKDIR /app

RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

RUN apk del .build-deps

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "src/server.ts"]
