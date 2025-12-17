# Multi-stage build for Landio
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Final stage
FROM node:18-alpine

# Install dumb-init to handle signals properly
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY package.json ./
COPY server.js ./
COPY routes/ ./routes/
COPY scripts/ ./scripts/
COPY *.html ./
COPY *.js ./
COPY *.css ./
COPY *.svg ./

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use dumb-init as entrypoint to properly handle signals
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Run the application
CMD ["npm", "start"]
