# UWIA - Guía de Despliegue

Guía completa para el despliegue en producción del sistema UWIA (Underwriting Intelligence API).

## 🚀 Preparación para Producción

### Requisitos del Sistema

#### Hardware Mínimo
- **CPU**: 2 cores (4 cores recomendado)
- **RAM**: 4GB (8GB recomendado)
- **Almacenamiento**: 20GB SSD
- **Red**: 100Mbps (conexión estable a internet para Gemini API)

#### Software
- **Docker**: 20.10+ y Docker Compose 2.0+
- **Node.js**: 18+ (si deployment directo)
- **MySQL**: 8.0+
- **Sistema Operativo**: Ubuntu 20.04+, CentOS 8+, o similar

### Variables de Entorno de Producción

Crear archivo `.env.production`:

```bash
# ============= SERVIDOR =============
NODE_ENV=production
PORT=5045
HOST=0.0.0.0

# ============= GOOGLE GEMINI API =============
GOOGLE_GEMINI_API_KEY=AIzaSy...your_real_api_key_here
GOOGLE_GEMINI_MODEL=gemini-1.5-pro
GEMINI_MAX_TOKENS=1048576
GEMINI_TEMPERATURE=0.1

# ============= BASE DE DATOS =============
DB_HOST=db
DB_PORT=3306
DB_USERNAME=uwia_prod
DB_PASSWORD=secure_password_here_123
DB_DATABASE=uwia_production
DB_SYNCHRONIZE=false
DB_LOGGING=false

# ============= LÍMITES DE ARCHIVO =============
MAX_FILE_SIZE=157286400              # 150MB
GEMINI_INLINE_MAX_SIZE=1048576       # 1MB
GEMINI_FILE_MAX_SIZE=52428800        # 50MB
GEMINI_SPLIT_THRESHOLD=52428800      # 50MB

# ============= RATE LIMITING =============
THROTTLE_TTL=60                      # 60 segundos
THROTTLE_LIMIT=30                    # 30 requests por TTL
GEMINI_RATE_LIMIT_RPM=60            # 60 requests/min a Gemini
GEMINI_MAX_RETRIES=3                # 3 reintentos
GEMINI_RETRY_DELAY=2000             # 2 segundos delay

# ============= LOGGING =============
LOG_LEVEL=info                       # info, warn, error
ENABLE_GEMINI_LOGGING=true          # Logs detallados de Gemini

# ============= CORS Y SEGURIDAD =============
CORS_ORIGIN=https://yourdomain.com   # Origen permitido para CORS
API_KEY_REQUIRED=false              # Set true si requiere API key
```

## 🐳 Deployment con Docker (Recomendado)

### 1. Preparar archivos de configuración

**docker-compose.prod.yml**:
```yaml
version: '3.8'

services:
  uwia-app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "5045:5045"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    depends_on:
      - uwia-db
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5045/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  uwia-db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root_password_here
      MYSQL_DATABASE: uwia_production
      MYSQL_USER: uwia_prod
      MYSQL_PASSWORD: secure_password_here_123
    ports:
      - "3306:3306"
    volumes:
      - uwia_db_data:/var/lib/mysql
      - ./database/scripts:/docker-entrypoint-initdb.d
    restart: always
    command: --default-authentication-plugin=mysql_native_password

volumes:
  uwia_db_data:
```

### 2. Configurar Nginx (Opcional pero recomendado)

**nginx.conf**:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirigir a HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # Certificados SSL (usar Let's Encrypt)
    ssl_certificate /etc/ssl/certs/your-domain.crt;
    ssl_certificate_key /etc/ssl/private/your-domain.key;

    # Configuración SSL segura
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;

    # Límites para archivos grandes
    client_max_body_size 200M;
    client_body_timeout 300s;

    location / {
        proxy_pass http://localhost:5045;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts para archivos grandes
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # Logs
    access_log /var/log/nginx/uwia_access.log;
    error_log /var/log/nginx/uwia_error.log;
}
```

### 3. Scripts de Despliegue

**deploy.sh**:
```bash
#!/bin/bash

echo "🚀 Iniciando despliegue de UWIA..."

# Verificar dependencias
command -v docker >/dev/null 2>&1 || { echo "❌ Docker no está instalado"; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo "❌ Docker Compose no está instalado"; exit 1; }

# Verificar variables de entorno
if [ ! -f .env.production ]; then
    echo "❌ Archivo .env.production no encontrado"
    exit 1
fi

# Backup de base de datos (si existe)
if docker ps | grep -q uwia-db; then
    echo "📦 Creando backup de base de datos..."
    docker exec uwia-db mysqldump -u uwia_prod -p uwia_production > backup_$(date +%Y%m%d_%H%M%S).sql
fi

# Pull latest changes
echo "📥 Obteniendo últimos cambios..."
git pull origin main

# Build and deploy
echo "🔨 Construyendo y desplegando..."
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d

# Verificar health
echo "🔍 Verificando estado del servicio..."
sleep 30
curl -f http://localhost:5045/api/health || { echo "❌ Health check falló"; exit 1; }

echo "✅ Despliegue completado exitosamente!"
echo "📊 Swagger disponible en: http://localhost:5045/api/docs"
echo "📋 Logs disponibles con: docker-compose -f docker-compose.prod.yml logs -f"
```

## 🛠️ Deployment Manual (Sin Docker)

### 1. Preparar el entorno

```bash
# Instalar Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instalar PM2 para gestión de procesos
npm install -g pm2

# Clonar repositorio
git clone <repository-url>
cd uwia

# Instalar dependencias
npm ci --only=production
```

### 2. Configurar base de datos

```bash
# Instalar MySQL
sudo apt update
sudo apt install mysql-server

# Configurar base de datos
sudo mysql -u root -p
CREATE DATABASE uwia_production;
CREATE USER 'uwia_prod'@'localhost' IDENTIFIED BY 'secure_password_here_123';
GRANT ALL PRIVILEGES ON uwia_production.* TO 'uwia_prod'@'localhost';
FLUSH PRIVILEGES;
EXIT;

# Ejecutar scripts de inicialización
mysql -u uwia_prod -p uwia_production < database/scripts/init.sql
```

### 3. Configurar PM2

**ecosystem.config.js**:
```javascript
module.exports = {
  apps: [{
    name: 'uwia-api',
    script: 'dist/main.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 5045
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    max_memory_restart: '1G',
    watch: false,
    ignore_watch: ['node_modules', 'logs']
  }]
};
```

### 4. Build y start

```bash
# Build del proyecto
npm run build

# Iniciar con PM2
pm2 start ecosystem.config.js --env production

# Guardar configuración PM2
pm2 save
pm2 startup
```

## 🔍 Monitoreo y Mantenimiento

### Logs Importantes

```bash
# Docker logs
docker-compose -f docker-compose.prod.yml logs -f uwia-app

# PM2 logs
pm2 logs uwia-api

# Logs específicos por componente
tail -f logs/uwia_*.log | grep "VALIDATION"     # Respuestas validadas
tail -f logs/uwia_*.log | grep "FILE-SKIP"     # Archivos saltados por tamaño
tail -f logs/uwia_*.log | grep "CONSOLIDATION" # Consolidación de chunks
```

### Health Checks

```bash
# Basic health
curl http://localhost:5045/api/health

# Detailed status
curl http://localhost:5045/api/health/detailed

# Database connectivity
curl http://localhost:5045/api/health/db
```

### Métricas de Performance

```bash
# PM2 monitoring
pm2 monit

# Docker stats
docker stats uwia-app

# Database performance
docker exec uwia-db mysql -u uwia_prod -p -e "SHOW FULL PROCESSLIST;"
```

### Backup y Restore

**Backup automático (crontab)**:
```bash
# Agregar a crontab (crontab -e)
0 2 * * * docker exec uwia-db mysqldump -u uwia_prod -p uwia_production > /backups/uwia_$(date +\%Y\%m\%d).sql

# Script de backup manual
#!/bin/bash
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
docker exec uwia-db mysqldump -u uwia_prod -p uwia_production > $BACKUP_DIR/uwia_$DATE.sql
echo "Backup creado: $BACKUP_DIR/uwia_$DATE.sql"
```

**Restore**:
```bash
# Desde backup
docker exec -i uwia-db mysql -u uwia_prod -p uwia_production < backup_file.sql
```

## 🚨 Troubleshooting

### Problemas Comunes

1. **"Out of memory" errors**:
   ```bash
   # Aumentar límites Docker
   # En docker-compose.yml
   mem_limit: 2g
   memswap_limit: 2g
   ```

2. **Timeouts en archivos grandes**:
   ```bash
   # Aumentar timeouts nginx
   proxy_read_timeout 600s;
   client_body_timeout 600s;
   ```

3. **Rate limiting de Gemini**:
   ```bash
   # Ajustar en .env
   GEMINI_RATE_LIMIT_RPM=30  # Bajar límite
   GEMINI_RETRY_DELAY=5000   # Aumentar delay
   ```

4. **Fallos de conexión BD**:
   ```bash
   # Verificar logs
   docker logs uwia-db

   # Restart servicio
   docker-compose restart uwia-db
   ```

### Comandos de Emergencia

```bash
# Restart rápido
docker-compose -f docker-compose.prod.yml restart uwia-app

# Rebuild completo
docker-compose -f docker-compose.prod.yml down
docker system prune -f
docker-compose -f docker-compose.prod.yml up -d --build

# Ver logs en tiempo real
docker-compose -f docker-compose.prod.yml logs -f --tail=100

# Estado de servicios
docker-compose -f docker-compose.prod.yml ps
```

## ✅ Checklist de Go-Live

### Pre-Deployment
- [ ] Variables de entorno configuradas correctamente
- [ ] API Key de Gemini válida y con créditos suficientes
- [ ] Base de datos configurada con scripts de inicialización
- [ ] Certificados SSL configurados (si aplica)
- [ ] Backup de datos existentes (si aplica)
- [ ] Testing en ambiente de staging completado

### Post-Deployment
- [ ] Health checks passing
- [ ] Swagger documentation accesible
- [ ] Logs generándose correctamente
- [ ] Rate limiting funcionando
- [ ] Procesamiento de documentos de prueba exitoso
- [ ] Monitoreo configurado
- [ ] Backup automático configurado
- [ ] Contactos de emergencia notificados

### Performance Validation
- [ ] Archivo < 1MB procesa en < 20 segundos
- [ ] Archivo 1-50MB procesa en < 60 segundos
- [ ] Archivo > 50MB procesa en < 120 segundos
- [ ] Rate limiting respeta límites configurados
- [ ] Memory usage estable bajo 1GB
- [ ] No memory leaks después de 24 horas

---

**Versión**: 2.0.0 | **Fecha**: 2025-09-20 | **Mantenido por**: Equipo UWIA