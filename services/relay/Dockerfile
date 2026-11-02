# Build from the repo root:  docker build -f services/relay/Dockerfile -t hive-relay .
FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN npm install --workspace @hive/relay --include-workspace-root=false --no-audit --no-fund \
 && npx esbuild services/relay/src/main.ts --bundle --platform=node --target=node22 --format=cjs \
      --alias:@hive/collab=./packages/collab/src/index.ts --outfile=/out/relay.cjs

FROM node:22-alpine
WORKDIR /app
COPY --from=build /out/relay.cjs ./relay.cjs
ENV PORT=4455 DATA_DIR=/data
VOLUME /data
EXPOSE 4455
HEALTHCHECK CMD wget -qO- http://localhost:4455/health || exit 1
CMD ["node", "relay.cjs"]
