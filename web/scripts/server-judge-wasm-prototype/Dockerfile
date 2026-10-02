FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY fetch-model.mjs judge-wasm-server.mjs judge-worker.mjs queue.mjs server.mjs ./
RUN node fetch-model.mjs

ENV PORT=8788
EXPOSE 8788

# JUDGE_ALLOWED_ORIGIN must be set at deploy time to the real production
# origin (e.g. https://biccyanzac-pixel.github.io) - it defaults to the
# local dev server's origin, which is wrong for any real deployment.
CMD ["node", "server.mjs"]
