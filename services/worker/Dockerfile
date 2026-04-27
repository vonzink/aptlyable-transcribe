# syntax=docker/dockerfile:1.6
#
# Build context = repo root. CDK passes that via:
#   ecs.ContainerImage.fromAsset(repoRoot, { file: 'services/worker/Dockerfile' })
#
# Stage 1 builds packages/shared + services/worker into dist/.
# Stage 2 ships only the worker workspace's prod deps + compiled output.

# ---- Stage 1: build ----
FROM node:20-alpine AS build
WORKDIR /repo

# Copy workspace skeleton (lockfile + every workspace's package.json) so
# `npm ci` can resolve the workspace graph without copying source.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/
COPY services/worker/package.json services/worker/
COPY apps/web/package.json apps/web/
COPY infrastructure/package.json infrastructure/

# Install everything once — caches well across rebuilds when only worker
# source changes.
RUN npm ci --no-audit --no-fund

# Bring in the source for the two workspaces this image actually builds.
COPY packages/shared packages/shared
COPY services/worker services/worker

RUN npm --workspace packages/shared run build \
 && npm --workspace services/worker run build


# ---- Stage 2: runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Re-create just enough of the monorepo layout for npm workspaces to
# resolve `@aptlyable/shared` from the worker's node_modules symlink.
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/services/worker/package.json services/worker/
COPY --from=build /repo/services/worker/dist services/worker/dist

# Stub the other workspaces with minimal package.json files so the
# lockfile-based install accepts the trimmed tree.
RUN mkdir -p services/api apps/web infrastructure \
 && printf '{"name":"@aptlyable/api","version":"0.1.0","private":true}\n' > services/api/package.json \
 && printf '{"name":"@aptlyable/web","version":"0.1.0","private":true}\n' > apps/web/package.json \
 && printf '{"name":"@aptlyable/infrastructure","version":"0.1.0","private":true}\n' > infrastructure/package.json

# Production-only install scoped to the worker workspace.
RUN npm ci --omit=dev --no-audit --no-fund --workspace services/worker

# Drop privileges. node:20-alpine ships with uid 1000 `node`.
USER node
WORKDIR /app/services/worker

# Node 20 handles SIGTERM natively; the worker drains in-flight jobs in
# transcriptionWorker.ts before exiting (see graceful-shutdown notes there).
CMD ["node", "dist/index.js"]
