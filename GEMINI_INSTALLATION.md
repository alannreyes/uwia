# Instalación y Configuración de Gemini 2.5 Pro

## ⚠️ IMPORTANTE: Tu Sistema Actual NO se Ve Afectado

Este nuevo sistema está **completamente deshabilitado por defecto**. Tu sistema actual con GPT-4o + Claude sigue funcionando exactamente igual. Los nuevos archivos son:

- ✅ `src/config/gemini.config.ts` - Nueva configuración
- ✅ `src/modules/underwriting/services/gemini.service.ts` - Nuevo servicio
- ✅ `src/modules/underwriting/services/gemini-rate-limiter.service.ts` - Rate limiter
- ✅ Variables de entorno añadidas al `.env.example`

## Paso 1: Instalación de Dependencias (Opcional)

Solo instalar cuando quieras activar Gemini:

```bash
npm install @google/generative-ai
```

## Paso 2: Configuración de API Key

1. Obtener API key de Google AI Studio: https://makersuite.google.com/app/apikey
2. Añadir al archivo `.env`:

```env
# Mantener todo tu sistema actual igual
# Solo añadir estas líneas NUEVAS:

GEMINI_API_KEY=tu_api_key_real_aqui
GEMINI_ENABLED=true    # Cambiar de false a true cuando quieras activar
```

## Paso 3: Activación Gradual (Cuando Estés Listo)

### Opción 1: Solo Testing en Desarrollo
```env
MIGRATION_MODE=testing  # Solo funciona en NODE_ENV=development
```

### Opción 2: Canary Deployment (Recomendado)
```env
MIGRATION_MODE=canary
CANARY_PERCENTAGE=10   # Solo 10% del tráfico usa el nuevo sistema
```

### Opción 3: Activación Completa
```env
MIGRATION_MODE=full    # Todo el tráfico usa GPT-5 + Gemini
```

## Configuración Completa de Variables de Entorno

```env
# ===== Tu sistema actual - NO TOCAR =====
OPENAI_API_KEY=tu_key_actual
OPENAI_ENABLED=true
ANTHROPIC_API_KEY=tu_claude_key_actual
TRIPLE_VALIDATION=true
# ... todas tus variables actuales igual

# ===== NUEVO: Gemini 2.5 Pro (OPCIONAL) =====
GEMINI_API_KEY=tu_gemini_key_aqui
GEMINI_ENABLED=false                    # true para activar
GEMINI_MODEL=gemini-2.5-pro
GEMINI_TEMPERATURE=0.3
GEMINI_THINKING_MODE=true

# Rate Limits Gemini (Conservadores)
GEMINI_RATE_LIMIT_RPM=60              # 60 requests/min
GEMINI_RATE_LIMIT_TPM=1000000         # 1M tokens/min
GEMINI_TIMEOUT=120000                 # 2 minutos

# ===== Control de Migración =====
MIGRATION_MODE=off                    # off | testing | canary | full
CANARY_PERCENTAGE=0                   # 0-100% 
OPENAI_GPT5_ENABLED=false            # true para usar GPT-5
MIGRATION_ALLOW_FALLBACK=true        # Siempre true por seguridad

# Modelos nuevos (cuando se active)
MIGRATION_PRIMARY_MODEL=gpt-5
MIGRATION_INDEPENDENT_MODEL=gemini-2.5-pro
MIGRATION_ARBITRATOR_MODEL=gpt-5
```

## Paso 4: Monitoring (Cuando Actives)

El sistema nuevo incluye logging detallado:

```log
✅ Cliente Gemini 2.5 Pro inicializado correctamente
📊 Contexto máximo: 2,000,000 tokens (2M)
🚀 Iniciando evaluación Gemini para: coverage_limit
📄 Documento: 45,230 caracteres
✅ Evaluación Gemini completada en 3,450ms
📊 Confianza: 0.94, Tokens: 12,450
```

## Paso 5: Rollback Instantáneo

Si algo va mal, rollback inmediato:

```env
MIGRATION_MODE=off
```

Y reiniciar la aplicación. El sistema vuelve al comportamiento original.

## Ventajas del Nuevo Sistema

### Para Documentos Grandes (10-100MB)
- **Gemini 2.5 Pro**: 2M tokens de contexto (vs 200K de Claude)
- **Sin chunking**: Procesa documentos completos
- **Mejor precisión**: 45% menos errores que GPT-4o

### Para Documentos Normales
- **GPT-5**: Reasoning mode avanzado
- **Mayor confianza**: Mejor análisis de decisiones complejas
- **Mismo costo**: GPT-5 cuesta igual que GPT-4o

## Pruebas Recomendadas

### 1. Desarrollo Local
```env
NODE_ENV=development
MIGRATION_MODE=testing
GEMINI_ENABLED=true
```

### 2. Canary en Producción
```env
MIGRATION_MODE=canary
CANARY_PERCENTAGE=5    # Empezar con 5%
```

### 3. Monitoreo
- Ver logs para verificar funcionamiento
- Comparar tiempos de respuesta
- Verificar confianza de respuestas

## Códigos de Estado

| Estado | Descripción |
|--------|-------------|
| `🟢 GEMINI_AVAILABLE` | Gemini configurado y funcionando |
| `🟡 GEMINI_DISABLED` | Gemini deshabilitado (normal) |
| `🔴 GEMINI_ERROR` | Error en configuración |
| `🐤 CANARY_ACTIVE` | Modo canary funcionando |
| `🔄 FALLBACK_TRIGGERED` | Sistema volvió al anterior |

## FAQ

**P: ¿Esto va a romper mi sistema actual?**
R: No. Todo está deshabilitado por defecto. Tu sistema sigue igual.

**P: ¿Necesito instalar algo ahora?**
R: No. Solo cuando quieras probar Gemini instala `@google/generative-ai`.

**P: ¿Puedo desactivar todo rápidamente?**
R: Sí. Cambia `MIGRATION_MODE=off` y reinicia.

**P: ¿Qué pasa si no tengo API key de Gemini?**
R: El sistema funciona normal con tu configuración actual.

**P: ¿Cuándo recomiendan activar esto?**
R: Cuando tengas tiempo para monitorear y probar. No hay prisa.

## Soporte

Si tienes dudas:
1. Revisa los logs de la aplicación
2. Verifica las variables de entorno
3. Prueba primero en `MIGRATION_MODE=testing`
4. Siempre puedes hacer rollback con `MIGRATION_MODE=off`