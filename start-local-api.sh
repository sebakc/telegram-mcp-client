#!/bin/bash

# Quick script to start/restart Telegram Bot API Local
# Reads credentials from .env file

set -e

# Load .env
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    exit 1
fi

export $(grep -v '^#' .env | xargs)

# Check credentials
if [ -z "$TELEGRAM_API_ID" ] || [ -z "$TELEGRAM_API_HASH" ]; then
    echo "❌ TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env"
    echo ""
    echo "1. Go to https://my.telegram.org/apps"
    echo "2. Create an application"
    echo "3. Add to .env:"
    echo "   TELEGRAM_API_ID=your_id"
    echo "   TELEGRAM_API_HASH=your_hash"
    exit 1
fi

# Create data directory
DATA_DIR="$HOME/telegram-bot-api-data"
mkdir -p "$DATA_DIR"

# Stop existing container
if docker ps -a | grep -q telegram-bot-api; then
    echo "🔄 Stopping existing container..."
    docker stop telegram-bot-api 2>/dev/null || true
    docker rm telegram-bot-api 2>/dev/null || true
fi

# Start new container
echo "🚀 Starting Telegram Bot API Local..."
echo "   API ID: $TELEGRAM_API_ID"
docker run -d \
  --name telegram-bot-api \
  --restart=always \
  -e TELEGRAM_API_ID="$TELEGRAM_API_ID" \
  -e TELEGRAM_API_HASH="$TELEGRAM_API_HASH" \
  -e TELEGRAM_LOCAL=true \
  -v "$DATA_DIR:/var/lib/telegram-bot-api" \
  -p 8081:8081 \
  aiogram/telegram-bot-api:latest

# Wait and verify
sleep 3

if docker ps | grep -q telegram-bot-api; then
    echo "✅ Telegram Bot API Local is running on http://localhost:8081"
    echo ""
    echo "View logs: docker logs -f telegram-bot-api"
    echo "Stop: docker stop telegram-bot-api"
else
    echo "❌ Failed to start. Check logs: docker logs telegram-bot-api"
    exit 1
fi
