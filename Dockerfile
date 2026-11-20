FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
ARG VITE_ASSIGNMENT_SUPABASE_URL
ARG VITE_ASSIGNMENT_PROJECT_REF
ARG VITE_ASSIGNMENT_SUPABASE_KEY
ARG VITE_ASSIGNMENT_OAUTH_PROVIDERS
ARG VITE_ASSIGNMENT_MCP_URL
RUN npm run build:deploy
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8788 ASSIGNMENT_STATIC_DIR=/app/docs
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/docs ./docs
COPY bridge ./bridge
USER node
EXPOSE 8788
CMD ["node", "bridge/server.js"]
