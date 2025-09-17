# 🤖 Guía de Uso del GeminiFileApiService

## 📋 Resumen
El `GeminiFileApiService` es un servicio especializado para procesar documentos PDF usando la API de Gemini de Google. Implementa detección automática de tamaño para usar el método óptimo de procesamiento.

## 🔧 Configuración Requerida

### Variables de Entorno
```env
GEMINI_API_KEY=tu_api_key_aqui
GEMINI_ENABLED=true
```

### Dependencias
```bash
npm install @google/generative-ai
```

## 🚀 Funcionamiento Automático

### Detección de Método
- **< 20MB**: Usa Inline API (más rápido)
- **20MB - 50MB**: Usa File API (archivos grandes)
- **> 50MB**: Requiere división (limitación de Gemini)

### Ejemplo de Uso
```javascript
const geminiService = new GeminiFileApiService();

// Verificar si está habilitado
if (geminiService.isEnabled()) {
  const result = await geminiService.processPdfDocument(
    pdfBuffer, 
    "What is the policy number?"
  );
  
  console.log(result.response);
  console.log(`Método usado: ${result.method}`);
  console.log(`Tiempo: ${result.processingTime}ms`);
}
```

## 📊 Resultados de Pruebas

### ✅ POLICY11.pdf (11MB, escaneado)
- **Método**: Inline API
- **Tiempo**: ~2m 14s
- **Resultado**: ✅ Perfecto - Extrajo policy number, asegurado, coberturas completas

### ✅ POLICY12.pdf (12MB, digital) 
- **Método**: Inline API
- **Tiempo**: ~57s
- **Resultado**: ✅ Perfecto - Más rápido por ser digital

### ❌ POLICY64.pdf (66MB, escaneado)
- **Método**: File API
- **Resultado**: ❌ Excede límite de 50MB
- **Solución**: División en chunks requerida

## 🎯 Ventajas del Servicio

1. **Detección Automática**: Elige el mejor método según tamaño
2. **OCR Nativo**: Procesa PDFs escaneados sin configuración adicional
3. **Alta Precisión**: Extrae datos complejos de pólizas de seguros
4. **Manejo de Errores**: Logs detallados y fallbacks
5. **Optimización**: Inline API para archivos pequeños, File API para grandes

## 🔗 Integración en UnderwritingService

```typescript
// En underwriting.service.ts
async shouldUseGeminiFileApi(pdfBuffer: Buffer, textLength: number): Promise<boolean> {
  const fileSizeMB = pdfBuffer.length / (1024 * 1024);
  const charsPerMB = textLength / fileSizeMB;
  
  // Usar Gemini para PDFs image-heavy o grandes
  return fileSizeMB > 10 && charsPerMB < 200;
}

async processWithGeminiFileApi(pdfBuffer: Buffer, prompt: string): Promise<any> {
  try {
    const result = await this.geminiFileApiService.processPdfDocument(pdfBuffer, prompt);
    this.logger.log(`✅ Gemini procesamiento exitoso: ${result.method}`);
    return result;
  } catch (error) {
    this.logger.error(`❌ Gemini error: ${error.message}`);
    throw error;
  }
}
```

## 🛠️ Para Archivos > 50MB

**Próxima implementación**: División automática en chunks de máximo 40MB cada uno, procesamiento paralelo y consolidación de resultados.

## 📝 Notas Importantes

- **Límite File API**: 50MB máximo
- **Límite Inline API**: 20MB recomendado
- **Páginas máximas**: 1000 páginas por documento
- **Formatos**: Solo PDF (otros formatos solo extraen texto)
- **Costo**: Cada página = 258 tokens

---
*Última actualización: Septiembre 17, 2025*