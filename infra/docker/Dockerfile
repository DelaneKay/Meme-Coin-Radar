# Multi-stage build for Meme Coin Radar API
# Stage 1: Build dependencies and compile TypeScript
FROM node:18.17.0-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./
COPY api/package*.json ./api/
COPY frontend/package*.json ./frontend/
COPY sentinel/package*.json ./sentinel/

# Install dependencies (including dev dependencies for build)
RUN npm ci --include=dev

# Copy source code
COPY . .

# Build the API
RUN npm run build --workspace=api

# Stage 2: Production runtime
FROM node:18.17.0-alpine AS runtime

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY api/package*.json ./api/

# Install only production dependencies
RUN npm ci --only=production --workspace=api && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/api/dist ./api/dist
COPY --from=builder --chown=nodejs:nodejs /app/shared ./shared

# Copy any additional runtime files
COPY --chown=nodejs:nodejs api/.env.example ./api/

# Create logs directory
RUN mkdir -p /app/logs && chown nodejs:nodejs /app/logs

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "api/dist/index.js"]