# Guía de Deployment en EasyPanel

## Prerrequisitos

1. Tener acceso a EasyPanel
2. Base de datos MySQL ya configurada (axioma)
3. Credenciales de OpenAI

## Paso 1: Preparar la Base de Datos

### Opción A: Usando phpMyAdmin o cliente MySQL

1. Conéctate a tu base de datos MySQL:
```bash
mysql -h automate_mysql -u mysql -p27d9IyP3Tyg19WUL8a6T axioma
```

2. Ejecuta los scripts SQL en orden:
```bash
# Script 1: Configuración de base de datos
mysql -h automate_mysql -u mysql -p27d9IyP3Tyg19WUL8a6T axioma < database/scripts/01_create_database.sql

# Script 2: Crear tablas
mysql -h automate_mysql -u mysql -p27d9IyP3Tyg19WUL8a6T axioma < database/scripts/02_create_tables.sql

# Script 3: Crear índices
mysql -h automate_mysql -u mysql -p27d9IyP3Tyg19WUL8a6T axioma < database/scripts/03_create_indexes.sql
```

### Opción B: Copiar y pegar en phpMyAdmin

1. Abre phpMyAdmin
2. Selecciona la base de datos `axioma`
3. Ve a la pestaña SQL
4. Copia y pega el contenido de cada archivo SQL en orden:
   - `database/scripts/01_create_database.sql`
   - `database/scripts/02_create_tables.sql`
   - `database/scripts/03_create_indexes.sql`

## Paso 2: Configurar la Aplicación en EasyPanel

### 2.1 Crear Nueva Aplicación

1. En EasyPanel, haz clic en "Create App"
2. Nombre: `uwia`
3. Tipo: Docker

### 2.2 Configurar el Repositorio

1. Source: GitHub
2. Repository: `https://github.com/alannreyes/uwia`
3. Branch: `main`
4. Build Path: `/`

### 2.3 Configurar Variables de Entorno

En la sección "Environment Variables", agrega todas estas variables:

```env
# API Configuration
PORT=5035
NODE_ENV=production

# Database Configuration
DB_HOST=automate_mysql
DB_PORT=3306
DB_USERNAME=mysql
DB_PASSWORD=27d9IyP3Tyg19WUL8a6T
DB_DATABASE=axioma

# OpenAI Configuration
OPENAI_API_KEY=TU_OPENAI_API_KEY_AQUI
OPENAI_MODEL=gpt-4o
OPENAI_ENABLED=true
OPENAI_TIMEOUT=30000
OPENAI_TEMPERATURE=0.3
OPENAI_MAX_TOKENS=1000
OPENAI_MAX_TEXT_LENGTH=30000
OPENAI_USE_FOR_SIMPLE_PDFS_ONLY=true
OPENAI_FALLBACK_TO_LOCAL=true

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=30
OPENAI_RATE_LIMIT_RPM=30
OPENAI_RATE_LIMIT_TPM=30000
OPENAI_MAX_RETRIES=3
OPENAI_RETRY_DELAY=2000

# File Upload
MAX_FILE_SIZE=52428800

# Processing
LOCAL_PROCESSING_DEFAULT=false
LOCAL_PROCESSING_FOR_COMPLEX_PDFS=true

# Application
CORS_ORIGIN=*
LOG_LEVEL=info
```

### 2.4 Configurar Build & Deploy

1. **Dockerfile Path**: `Dockerfile`
2. **Port**: `5035`
3. **Health Check Path**: `/api/underwriting/health`
4. **Resources**:
   - CPU: 0.5 - 1 core
   - Memory: 512MB - 1GB

### 2.5 Configurar Dominio (Opcional)

1. En la sección "Domains"
2. Agregar dominio personalizado o usar el subdominio de EasyPanel
3. Habilitar HTTPS automático

## Paso 3: Deploy

1. Haz clic en "Deploy"
2. EasyPanel:
   - Clonará el repositorio
   - Construirá la imagen Docker
   - Desplegará el contenedor
   - Configurará el proxy reverso

## Paso 4: Verificar el Deployment

### 4.1 Health Check
```bash
curl https://tu-dominio.easypanel.host/api/underwriting/health
```

Respuesta esperada:
```json
{
  "status": "ok",
  "timestamp": "2024-12-17T10:00:00.000Z",
  "database": "connected"
}
```

### 4.2 Logs

En EasyPanel, ve a la sección "Logs" para ver:
- Logs de construcción
- Logs de aplicación
- Errores si los hay

## Paso 5: Probar la API

### Endpoint de Evaluación
```bash
curl -X POST https://tu-dominio.easypanel.host/api/underwriting/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "claim_reference": "TEST-001",
    "documents": [{
      "filename": "test.pdf",
      "file_content": "base64_encoded_pdf_content",
      "prompts": [{
        "question": "¿Cuál es la fecha del documento?",
        "expected_type": "date"
      }]
    }]
  }'
```

## Troubleshooting

### Error de Conexión a Base de Datos

1. Verifica que las credenciales sean correctas
2. Asegúrate de que el host `automate_mysql` sea accesible
3. Revisa que las tablas estén creadas

### Error de OpenAI

1. Verifica que la API key sea válida
2. Revisa los límites de rate limiting
3. Verifica los logs para más detalles

### La aplicación no inicia

1. Revisa los logs de construcción
2. Verifica que todas las variables de entorno estén configuradas
3. Asegúrate de que el puerto 5015 esté configurado correctamente

## Mantenimiento

### Actualizar la Aplicación

1. Haz push de los cambios a GitHub
2. En EasyPanel, haz clic en "Redeploy"
3. La aplicación se actualizará automáticamente

### Monitoreo

1. Configura alertas en EasyPanel
2. Revisa regularmente:
   - Logs de aplicación
   - Uso de recursos
   - Health checks

### Backup de Base de Datos

Es importante hacer backups regulares de las tablas:
- uw_claims
- uw_documents
- uw_evaluations
- uw_audit_log

```bash
# Ejemplo de backup
mysqldump -h automate_mysql -u mysql -p axioma uw_claims uw_documents uw_evaluations uw_audit_log > backup_uwia_$(date +%Y%m%d).sql
```
