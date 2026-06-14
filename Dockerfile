# Specify the Node.js version to use
ARG NODE_VERSION=22

# Specify the Debian version to use, the default is "bullseye"
ARG DEBIAN_VERSION=bullseye

# Use Node.js Docker image as the base image, with specific Node and Debian versions
FROM node:${NODE_VERSION}-${DEBIAN_VERSION} AS build

# Set the container's default shell to Bash and enable some options
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

# Install traceroute (used by the trace-route check) plus build tooling for any
# native dependencies. No browser is installed: tech-stack runs browserless and
# screenshots use a hosted API, so Chromium is no longer needed — keeping the
# image small and cold starts fast.
RUN apt-get update -qq --fix-missing && \
    apt-get -qqy --no-install-recommends install traceroute python make g++ && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory to /app
WORKDIR /app

# Copy package.json and yarn.lock to the working directory
COPY package.json yarn.lock ./

# Run yarn install to install dependencies and clear yarn cache
RUN apt-get update && \
    yarn install --frozen-lockfile --network-timeout 100000 && \
    rm -rf /app/node_modules/.cache

# Copy all files to working directory
COPY . .

# Run yarn build to build the application
RUN yarn build --production

# Final stage
FROM node:${NODE_VERSION}-${DEBIAN_VERSION}  AS final

WORKDIR /app

COPY package.json yarn.lock ./
COPY --from=build /app .

RUN apt-get update && \
    apt-get install -y --no-install-recommends traceroute && \
    rm -rf /var/lib/apt/lists/* /app/node_modules/.cache

# Exposed container port, the default is 3000, which can be modified through the environment variable PORT
EXPOSE ${PORT:-3000}

# No headless browser is bundled; belt-and-suspenders against any transitive
# puppeteer (pulled in by wappalyzer's package) downloading Chromium.
ENV PUPPETEER_SKIP_DOWNLOAD='true'

LABEL org.opencontainers.image.title="Web-Check" \
      org.opencontainers.image.description="All-in-one OSINT tool for analysing any website" \
      org.opencontainers.image.url="https://web-check.xyz" \
      org.opencontainers.image.source="https://github.com/lissy93/web-check" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Alicia Sykes"

# Define the command executed when the container starts and start the server.js of the Node.js application
CMD ["yarn", "start"]
