#!/bin/sh

# Generate self-signed SSL certificates for local HTTPS
CERT_DIR="/app/certs"
mkdir -p "$CERT_DIR"

if [ ! -f "$CERT_DIR/server.key" ] || [ ! -f "$CERT_DIR/server.crt" ]; then
    echo "Generating self-signed SSL certificates..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$CERT_DIR/server.key" \
        -out "$CERT_DIR/server.crt" \
        -subj "/C=US/ST=State/L=City/O=Landio/CN=landio.local" \
        -addext "subjectAltName=DNS:landio.local,DNS:localhost,IP:127.0.0.1,IP:192.168.1.183"
    echo "SSL certificates generated successfully"
else
    echo "SSL certificates already exist"
fi
