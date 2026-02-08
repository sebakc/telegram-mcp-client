# Configuración de Telegram Bot API Local

Para manejar archivos grandes (hasta 2GB), necesitas ejecutar un servidor local de Telegram Bot API.

## Instalación en macOS

### Opción 1: Usando Docker (Recomendado)

```bash
# Crear directorio para datos persistentes
mkdir -p ~/telegram-bot-api-data

# Ejecutar servidor local
docker run -d \
  --name telegram-bot-api \
  --restart=always \
  -v ~/telegram-bot-api-data:/var/lib/telegram-bot-api \
  -p 8081:8081 \
  aiogram/telegram-bot-api:latest \
  --local \
  --api-id=YOUR_API_ID \
  --api-hash=YOUR_API_HASH
```

**IMPORTANTE**: Necesitas obtener `api-id` y `api-hash` de https://my.telegram.org/apps

### Opción 2: Compilar desde fuente

```bash
# Instalar dependencias
brew install gperf cmake openssl

# Clonar repositorio
git clone --recursive https://github.com/tdlib/telegram-bot-api.git
cd telegram-bot-api

# Compilar
mkdir build
cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
cmake --build . --target install

# Ejecutar
./telegram-bot-api --local --api-id=YOUR_API_ID --api-hash=YOUR_API_HASH
```

## Obtener API ID y API Hash

1. Ve a https://my.telegram.org/apps
2. Inicia sesión con tu número de teléfono
3. Crea una nueva aplicación
4. Copia `api_id` y `api_hash`

## Configuración del Bot

Una vez que el servidor local esté corriendo en `http://localhost:8081`:

### 1. Configurar el bot para usar API local

Edita tu `.env`:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_API_URL=http://localhost:8081  # API local
USE_LOCAL_API=true
```

### 2. Reiniciar el bot

```bash
npm run dev
```

## Verificar que funciona

```bash
# Probar que el servidor local responde
curl http://localhost:8081/bot<YOUR_BOT_TOKEN>/getMe
```

Deberías ver la información de tu bot.

## Diferencias con API Pública

| Característica | API Pública | API Local |
|----------------|-------------|-----------|
| Límite de descarga | 20 MB | 2 GB |
| Límite de subida | 50 MB | 2 GB |
| Velocidad | Varía | Local (rápido) |
| Setup | Ninguno | Requiere servidor |

## Troubleshooting

### Puerto 8081 ya en uso
```bash
# Cambiar puerto
docker run -p 8082:8081 ... # Usar 8082 en lugar de 8081
```

### API local no responde
```bash
# Ver logs
docker logs telegram-bot-api

# Reiniciar
docker restart telegram-bot-api
```

### Bot no se conecta
- Verifica que `TELEGRAM_API_URL` tenga el puerto correcto
- Asegúrate que el servidor esté corriendo: `docker ps`
- Revisa que el token sea válido
