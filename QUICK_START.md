# 🚀 Quick Start Guide

Guía rápida para poner en marcha el bot con soporte para archivos grandes.

## ⚡ Setup Rápido (5 minutos)

### 1. Obtener Credenciales de Telegram API

1. Ve a https://my.telegram.org/apps
2. Inicia sesión con tu número de teléfono
3. Crea una nueva aplicación
4. **Copia `api_id` y `api_hash`** - los necesitarás en el siguiente paso

### 2. Configurar Telegram Bot API Local (Docker)

Ejecuta el script automático:

```bash
./setup-telegram-local-api.sh
```

Te pedirá:
- **API ID**: El número que copiaste
- **API HASH**: El hash que copiaste

El script:
- ✅ Descarga la imagen Docker
- ✅ Configura el servidor local
- ✅ Lo deja corriendo en puerto 8081

### 3. Verificar que el Servidor Local Funciona

```bash
# Ver logs del servidor
docker logs -f telegram-bot-api

# Ver que esté corriendo
docker ps | grep telegram-bot-api
```

Deberías ver algo como:
```
telegram-bot-api   Up 2 minutes   8081/tcp
```

### 4. Verificar Configuración del Bot

Tu archivo `.env` debe tener:

```env
# Bot token de @BotFather
TELEGRAM_BOT_TOKEN=tu_token_aqui

# API Local HABILITADA (obligatorio)
USE_LOCAL_API=true
TELEGRAM_API_URL=http://localhost:8081

# Google AI
GOOGLE_API_KEY=tu_key_aqui
GOOGLE_MODEL=gemini-1.5-pro
AI_PROVIDER=google
```

### 5. Iniciar el Bot

```bash
npm run dev
```

Deberías ver:
```
info: Using Telegram Bot API Local at: http://localhost:8081
info: Auto-connecting to PDF Translator...
info: Connected to PDF Translator, found 2 tools: translate_pdf, analyze_pdf
info: Telegram bot started successfully!
```

## 🧪 Probar el Bot

### Opción 1: Enviar un PDF

1. Abre Telegram y busca tu bot
2. Envía `/start`
3. Envía un archivo PDF (cualquier tamaño hasta 2GB)
4. Agrega un caption: "Traduce a español"

### Opción 2: Usar Ruta de Archivo

Si el archivo está en tu sistema:

```
Traduce /Users/me/documento.pdf a francés
```

## 📁 Límites de Archivo

| Configuración | Límite de Descarga | Límite de Subida |
|---------------|-------------------|------------------|
| **API Local** | **2 GB** | **2 GB** |
| API Pública   | 20 MB | 50 MB |

Con la configuración actual (USE_LOCAL_API=true), puedes manejar archivos de hasta **2GB**.

## 🐛 Troubleshooting

### El bot dice "file is too big"

Significa que la API local NO está funcionando. Verifica:

```bash
# 1. ¿El servidor está corriendo?
docker ps | grep telegram-bot-api

# 2. ¿Puedes hacer ping al servidor?
curl http://localhost:8081/bot<TU_TOKEN>/getMe

# 3. ¿El .env tiene USE_LOCAL_API=true?
grep USE_LOCAL_API .env
```

### El servidor no responde

```bash
# Reiniciar el servidor
docker restart telegram-bot-api

# Ver errores
docker logs telegram-bot-api --tail 50
```

### Puerto 8081 ocupado

```bash
# Cambiar puerto en docker
docker stop telegram-bot-api
docker rm telegram-bot-api

docker run -d \
  --name telegram-bot-api \
  -v "$HOME/telegram-bot-api-data:/var/lib/telegram-bot-api" \
  -p 8082:8081 \
  aiogram/telegram-bot-api:latest \
  --local \
  --api-id=TU_API_ID \
  --api-hash=TU_API_HASH

# Actualizar .env
TELEGRAM_API_URL=http://localhost:8082
```

### El bot no traduce

1. Verifica que el servidor MCP esté corriendo:
   ```bash
   ls /Users/s.vega/dev/personal/pdf-translator/api/
   ```

2. Verifica `servers.json`:
   ```bash
   cat servers.json
   ```

   Debe contener:
   ```json
   {
     "id": "pdf-translator",
     "autoConnect": true,
     ...
   }
   ```

## 🔗 Enlaces Útiles

- Telegram Bot API Local: https://github.com/tdlib/telegram-bot-api
- Obtener API Credentials: https://my.telegram.org/apps
- BotFather (crear bot): https://t.me/botfather
- Documentación completa: `./TELEGRAM_LOCAL_API_SETUP.md`

## 💡 Comandos Útiles

```bash
# Ver logs del bot
npm run dev

# Ver logs de Telegram API Local
docker logs -f telegram-bot-api

# Detener API Local
docker stop telegram-bot-api

# Reiniciar API Local
docker restart telegram-bot-api

# Eliminar API Local (y volver a configurar)
docker stop telegram-bot-api
docker rm telegram-bot-api
rm -rf ~/telegram-bot-api-data
./setup-telegram-local-api.sh
```

## ✅ Checklist de Verificación

Antes de reportar un problema, verifica:

- [ ] Docker está instalado y corriendo
- [ ] Servidor Telegram API Local está activo (`docker ps`)
- [ ] `.env` tiene `USE_LOCAL_API=true`
- [ ] `.env` tiene `TELEGRAM_API_URL=http://localhost:8081`
- [ ] Bot token es válido (de @BotFather)
- [ ] Google API key es válida
- [ ] `servers.json` contiene el servidor pdf-translator
- [ ] El bot muestra "Using Telegram Bot API Local" al iniciar

Si todos están ✅ pero sigue sin funcionar, revisa los logs:
```bash
docker logs telegram-bot-api
```
