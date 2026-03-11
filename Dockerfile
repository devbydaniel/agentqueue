# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ src/

RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ dist/
COPY config/ config/

# agentfiles and agent CLIs (pi, claude, etc.) are NOT bundled in this image.
# They must be mounted or installed separately in the runtime environment.
# Example: mount host binaries via docker-compose volumes.

# Run as non-root user.
# If you mount volumes (e.g. agent CLIs), ensure file permissions match this user.
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000

CMD ["node", "dist/main.js"]
