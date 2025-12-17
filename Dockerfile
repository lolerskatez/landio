# Multi-stage build for Landio
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Final stage
FROM node:18-alpine

# Install dumb-init and openssl for certificate generation
RUN apk add --no-cache dumb-init openssl

WORKDIR /app

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY package.json ./
COPY server.js ./
COPY routes/ ./routes/
COPY scripts/ ./scripts/
COPY assets/ ./assets/
COPY *.html ./
COPY *.js ./
COPY *.css ./
COPY *.svg ./

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Create certs directory
RUN mkdir -p /app/certs

# Copy certificate generation script
COPY scripts/generate-certs.sh /app/scripts/

# Make script executable
RUN chmod +x /app/scripts/generate-certs.sh

# Expose ports
EXPOSE 3001 3443

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use dumb-init as entrypoint to properly handle signals
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Generate certificates and run the application
CMD ["/bin/sh", "-c", "/app/scripts/generate-certs.sh && npm start"]
