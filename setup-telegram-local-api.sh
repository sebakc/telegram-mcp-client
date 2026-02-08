#!/bin/bash

# Telegram Bot API Local Setup Script
# This script helps you quickly set up Telegram Bot API Local using Docker

set -e

echo "🤖 Telegram Bot API Local Setup"
echo "================================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first:"
    echo "   https://docs.docker.com/get-docker/"
    exit 1
fi

echo "✅ Docker is installed"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "Please create a .env file from .env.example:"
    echo "   cp .env.example .env"
    echo "   nano .env  # Edit and add your credentials"
    exit 1
fi

# Load environment variables from .env
echo "📝 Loading credentials from .env file..."
export $(grep -v '^#' .env | xargs)

# Check if credentials are set
if [ -z "$TELEGRAM_API_ID" ] || [ -z "$TELEGRAM_API_HASH" ]; then
    echo "❌ TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env file"
    echo ""
    echo "Get your credentials from: https://my.telegram.org/apps"
    echo "Then add them to your .env file:"
    echo "   TELEGRAM_API_ID=your_api_id"
    echo "   TELEGRAM_API_HASH=your_api_hash"
    exit 1
fi

API_ID=$TELEGRAM_API_ID
API_HASH=$TELEGRAM_API_HASH

echo "✅ Credentials loaded from .env"
echo "   API ID: $API_ID"

echo ""
echo "🚀 Starting Telegram Bot API Local server..."
echo ""

# Create data directory
DATA_DIR="$HOME/telegram-bot-api-data"
mkdir -p "$DATA_DIR"

# Stop and remove existing container if it exists
if docker ps -a | grep -q telegram-bot-api; then
    echo "🗑️  Removing existing container..."
    docker stop telegram-bot-api 2>/dev/null || true
    docker rm telegram-bot-api 2>/dev/null || true
fi

# Run the container
docker run -d \
  --name telegram-bot-api \
  --restart=always \
  -e TELEGRAM_API_ID="$API_ID" \
  -e TELEGRAM_API_HASH="$API_HASH" \
  -v "$DATA_DIR:/var/lib/telegram-bot-api" \
  -p 8081:8081 \
  aiogram/telegram-bot-api:latest \
  --local

# Wait for container to start
echo ""
echo "⏳ Waiting for server to start..."
sleep 5

# Check if container is running
if docker ps | grep -q telegram-bot-api; then
    echo ""
    echo "✅ Telegram Bot API Local is running!"
    echo ""
    echo "📋 Configuration:"
    echo "   API URL: http://localhost:8081"
    echo "   Data directory: $DATA_DIR"
    echo ""
    echo "🔧 Next steps:"
    echo "1. Update your .env file:"
    echo "   USE_LOCAL_API=true"
    echo "   TELEGRAM_API_URL=http://localhost:8081"
    echo ""
    echo "2. Start your bot:"
    echo "   npm run dev"
    echo ""
    echo "📊 To view logs:"
    echo "   docker logs -f telegram-bot-api"
    echo ""
    echo "🛑 To stop the server:"
    echo "   docker stop telegram-bot-api"
    echo ""
else
    echo "❌ Failed to start Telegram Bot API Local"
    echo "Check logs with: docker logs telegram-bot-api"
    exit 1
fi
