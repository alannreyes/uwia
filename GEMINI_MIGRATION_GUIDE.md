# 🔄 Guía de Migración - GeminiFileApiService

## 📋 Variables de Entorno Requeridas

### ✅ **NUEVAS Variables (CRÍTICAS)**
Agregar al archivo `.env` de producción:

```env
# ===== GEMINI File API Configuration =====
GEMINI_API_KEY=tu_api_key_real_aqui
GEMINI_ENABLED=true
```

### 📌 **Variables Existentes (sin cambios)**
Estas variables YA existían y siguen siendo usadas por otros servicios:
- `OPENAI_API_KEY` - Para sistemas existentes
- `OPENAI_ENABLED` - Para sistemas existentes
- Todas las demás variables mantienen compatibilidad

## 🚀 **Pasos de Migración**

### 1. **Actualizar Variables de Entorno**
```bash
# En tu archivo .env de producción, agregar:
GEMINI_API_KEY=AIzaSy...tu_api_key_real
GEMINI_ENABLED=true
```

### 2. **Instalar Nuevas Dependencias**
```bash
npm install @google/generative-ai pdf-lib
```

### 3. **Verificar Funcionamiento**
```bash
# El servicio se auto-detecta al iniciar
# Busca estos logs al arrancar:
# ✅ Gemini File API Service inicializado correctamente
# 📏 Threshold: 20MB (File API para archivos mayores)
```

## 🔍 **Detección Automática**

El sistema detecta automáticamente cuándo usar Gemini:

- **< 20MB**: Inline API (rápido)
- **20-50MB**: File API (OCR avanzado)  
- **> 50MB**: División automática + consolidación

## ⚠️ **Compatibilidad**

- ✅ **100% Compatible**: Sistemas existentes siguen funcionando
- ✅ **Fallback**: Si Gemini falla, usa sistema anterior
- ✅ **Sin Breaking Changes**: No afecta funcionalidad existente

## 🎯 **Beneficios Inmediatos**

1. **PDFs escaneados**: Mejor OCR que el sistema anterior
2. **PDFs grandes**: Ahora procesables (antes fallaban)
3. **Velocidad**: Más rápido para PDFs digitales
4. **Precisión**: Mayor precisión en extracción de datos

## 📊 **Archivos Afectados**

### Archivos Nuevos:
- `src/modules/underwriting/services/gemini-file-api.service.ts`
- `GEMINI_USAGE_GUIDE.md`

### Archivos Modificados:
- `src/modules/underwriting/underwriting.module.ts` (agregó servicio)
- `src/modules/underwriting/underwriting.service.ts` (integración)
- `env.example` (nuevas variables)

### Dependencias Nuevas:
- `@google/generative-ai` 
- `pdf-lib`

---

## 🚨 **IMPORTANTE para Producción**

1. **API Key de Gemini**: Obtener de https://makersuite.google.com/app/apikey
2. **Límites de Quota**: Verificar límites de la API key
3. **Testing**: Probar con archivos reales antes del deploy
4. **Monitoreo**: Revisar logs después del deploy

---

*Última actualización: Septiembre 17, 2025*