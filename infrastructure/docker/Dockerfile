# Use a reviewed immutable digest via NODE_IMAGE at release time.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY . .
RUN pnpm install --frozen-lockfile
ARG SEO_ASSET_PREFIX
ENV SEO_ASSET_PREFIX=${SEO_ASSET_PREFIX}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# The shared workspace image retains operational tooling; it contains no secrets.
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node", "apps/api/dist/server.js"]
