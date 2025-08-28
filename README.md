# UWIA - Underwriting Inteligente con IA

Sistema backend en NestJS para procesamiento inteligente de documentos de underwriting utilizando OpenAI.

## Características

- **Análisis de documentos con IA**: Extracción y evaluación inteligente de información de documentos PDF
- **Validación doble**: Sistema de doble verificación para mayor precisión en las respuestas
- **Tipos de respuesta múltiples**: Soporte para boolean, date, text, number y JSON
- **Sistema de confianza**: Cálculo de confianza basado en evaluación primaria y validación
- **API RESTful**: Endpoints bien estructurados para integración fácil
- **Base de datos MySQL**: Almacenamiento persistente de evaluaciones y resultados

## Requisitos Previos

- Node.js 18+
- MySQL 5.7+
- NPM o Yarn
- Cuenta de OpenAI con API Key

## Instalación

1. Clonar el repositorio:
```bash
git clone https://github.com/[tu-usuario]/uwia.git
cd uwia
```

2. Instalar dependencias:
```bash
npm install
```

3. Configurar variables de entorno:
```bash
cp env.example .env
# Editar .env con tus credenciales
```

4. Ejecutar scripts de base de datos:
```bash
mysql -u [usuario] -p < database/scripts/01_create_database.sql
mysql -u [usuario] -p < database/scripts/02_create_tables.sql
mysql -u [usuario] -p < database/scripts/03_create_indexes.sql
```

## Configuración

### Variables de Entorno

```env
# API
PORT=5015
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=your_user
DB_PASSWORD=your_password
DB_DATABASE=axioma

# OpenAI
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4
OPENAI_TEMPERATURE=0.3
OPENAI_MAX_TOKENS=1000
```

## Uso

### Desarrollo
```bash
npm run start:dev
```

### Producción
```bash
npm run build
npm run start:prod
```

### Testing
```bash
npm run test
npm run test:e2e
npm run test:cov
```

## Estructura del Proyecto

```
src/
├── config/          # Configuraciones (DB, OpenAI, etc)
├── common/          # Utilidades compartidas
│   ├── filters/     # Filtros de excepciones
│   ├── interceptors/# Interceptores (logging, etc)
│   └── validators/  # Validadores personalizados
└── modules/
    └── underwriting/
        ├── dto/     # Data Transfer Objects
        ├── entities/# Entidades de base de datos
        └── services/# Lógica de negocio
```

## API Endpoints

### Health Check
```
GET /health
```

### Evaluar Documentos
```
POST /api/underwriting/evaluate
Content-Type: application/json

{
  "claim_reference": "CLAIM-001",
  "documents": [{
    "filename": "document.pdf",
    "file_content": "base64_encoded_content",
    "prompts": [{
      "question": "¿Cuál es la fecha del siniestro?",
      "expected_type": "date",
      "additional_context": "Formato MM-DD-YYYY"
    }]
  }]
}
```

## Base de Datos

### Tablas Principales

- **uw_claims**: Reclamaciones principales
- **uw_documents**: Documentos asociados a reclamaciones
- **uw_evaluations**: Evaluaciones de IA sobre documentos
- **uw_audit_log**: Registro de auditoría

## Seguridad

- Las credenciales nunca deben estar en el código
- Usar siempre variables de entorno
- La API key de OpenAI debe mantenerse segura
- Validación de entrada en todos los endpoints
- Logs de auditoría para trazabilidad

## Contribución

1. Fork el proyecto
2. Crear feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

## Licencia

Este proyecto está bajo licencia MIT.

## Soporte

Para soporte y preguntas, crear un issue en GitHub.