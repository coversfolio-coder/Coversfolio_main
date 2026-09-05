# Multi-stage build: compile the optimized production React build in one
# stage, then serve only the static output from a second, smaller stage.
#
# This replaces the previous single-stage Dockerfile, which ran the
# unoptimized development server (`yarn start`) - never actually correct for
# production traffic. It also switches to npm, matching what this project
# has actually used throughout (package-lock.json, not yarn.lock - the old
# Dockerfile's yarn usage was a leftover mismatch).
#
# Pulling `node:22-slim` from Docker Hub also sidesteps a real, observed
# failure mode: DigitalOcean's buildpack auto-detection path downloads a raw
# Node.js release tarball directly from nodejs.org via curl at build time,
# which was timing out repeatedly (partial downloads up to 95% complete,
# never finishing within the 30s window). Docker image layers are pulled
# through the Docker registry protocol instead - the same reliable path the
# backend's Dockerfile already uses successfully for its Python base image.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
RUN npm install -g serve@14.2.6
COPY --from=build /app/build ./build
EXPOSE 3000
CMD ["serve", "-s", "build", "-l", "3000"]
