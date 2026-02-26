FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for both packages
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci --prefix server && npm ci --prefix client

# Build backend and frontend
COPY server ./server
COPY client ./client
RUN npm run --prefix server build && npm run --prefix client build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Install only production deps for server runtime
COPY server/package*.json ./server/
RUN npm ci --omit=dev --prefix server

# Runtime artifacts
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/data ./server/data
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
