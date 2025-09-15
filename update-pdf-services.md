# 🔧 PDF Services Update Guide

## Cambios Implementados

### 1. **Nuevo PdfToolkitService** ✅
- Unifica todas las librerías PDF en un solo servicio
- Resuelve el problema de version mismatch
- Proporciona métodos robustos con fallback

### 2. **PdfImageServiceV2** ✅
- Usa el nuevo PdfToolkitService
- Múltiples métodos de fallback
- No falla si no puede convertir imágenes (continúa con texto)

## Pasos de Implementación

### Paso 1: Ejecutar script de dependencias
```bash
chmod +x fix-pdf-deps.sh
./fix-pdf-deps.sh
```

### Paso 2: Actualizar UnderwritingModule

```typescript
// src/modules/underwriting/underwriting.module.ts

import { PdfToolkitService } from './services/pdf-toolkit.service';
import { PdfImageServiceV2 } from './services/pdf-image-v2.service';

@Module({
  providers: [
    // ... otros servicios
    PdfToolkitService,        // NUEVO
    PdfImageServiceV2,        // NUEVO
    PdfParserService,         // Mantener por ahora
    PdfImageService,          // Mantener temporalmente para compatibilidad
    // ...
  ],
})
export class UnderwritingModule {}
```

### Paso 3: Actualizar UnderwritingService

```typescript
// src/modules/underwriting/underwriting.service.ts

constructor(
  // ... otros servicios
  private pdfToolkit: PdfToolkitService,           // NUEVO
  private pdfImageServiceV2: PdfImageServiceV2,    // NUEVO
  private pdfParserService: PdfParserService,      // Mantener por compatibilidad
  private pdfImageService: PdfImageService,        // Deprecado - usar V2
  // ...
) {}

// Actualizar método prepareDocument
private async prepareDocument(
  pdfContent: string | null,
  documentNeeds: { needsVisual: boolean; needsText: boolean },
  documentName: string
): Promise<{ text: string | null; images: Map<number, string> | null }> {
  if (!pdfContent) {
    return { text: null, images: null };
  }

  const result = { text: null as string | null, images: null as Map<number, string> | null };

  try {
    const buffer = Buffer.from(pdfContent, 'base64');

    // Usar nuevo PdfToolkit para extracción de texto
    if (documentNeeds.needsText) {
      const extraction = await this.pdfToolkit.extractText(buffer);
      result.text = extraction.text;
      this.logger.log(`📄 Text extracted: ${result.text?.length || 0} characters`);

      // Log adicional si detecta firmas
      if (extraction.hasSignatures) {
        this.logger.log(`✍️ Signature fields detected in ${documentName}`);
      }
    }

    // Usar nuevo PdfImageServiceV2 para imágenes
    if (documentNeeds.needsVisual) {
      try {
        const pagesToConvert = [1, 2, 3, 4, 5];
        result.images = await this.pdfImageServiceV2.convertPages(
          pdfContent,
          pagesToConvert,
          { documentName }
        );
        this.logger.log(`🖼️ Images extracted: ${result.images?.size || 0} pages`);
      } catch (imageError) {
        this.logger.warn(`⚠️ Image extraction failed: ${imageError.message}`);
        // No throw - continuar con solo texto
        result.images = new Map();
      }
    }

    return result;
  } catch (error) {
    this.logger.error(`❌ Error preparing document: ${error.message}`);
    // Retornar parcial si es posible
    return result;
  }
}
```

### Paso 4: Test específico para PDFs problemáticos

```typescript
// test-pdf-toolkit.ts
import { PdfToolkitService } from './src/modules/underwriting/services/pdf-toolkit.service';
import * as fs from 'fs';

async function testPdfToolkit() {
  const toolkit = new PdfToolkitService();

  // Test con LOP.pdf
  const lopPdf = fs.readFileSync('./test-documents/LOP.pdf');
  console.log('Testing LOP.pdf...');

  const lopInfo = await toolkit.getPdfInfo(lopPdf);
  console.log('LOP Info:', lopInfo);

  const lopExtraction = await toolkit.extractText(lopPdf);
  console.log('LOP has signatures:', lopExtraction.hasSignatures);
  console.log('LOP form fields:', lopExtraction.formFields.length);

  // Test conversión de imágenes
  const lopImages = await toolkit.convertToImages(lopPdf, [1, 2]);
  console.log('LOP images converted:', lopImages.size);

  // Test con POLICY.pdf
  const policyPdf = fs.readFileSync('./test-documents/POLICY.pdf');
  console.log('\nTesting POLICY.pdf...');

  const policyInfo = await toolkit.getPdfInfo(policyPdf);
  console.log('POLICY Info:', policyInfo);
}

testPdfToolkit().catch(console.error);
```

## Beneficios de la Nueva Arquitectura

### ✅ **Resuelve Problemas Actuales**
1. **Version mismatch**: Un solo punto de configuración de PDF.js
2. **Fallas de imagen**: Fallback automático, no detiene el procesamiento
3. **Detección de firmas**: Múltiples métodos de detección

### ✅ **Mejoras Adicionales**
1. **OCR Ready**: Preparado para agregar Tesseract.js
2. **Metadata extraction**: Extrae toda la información del PDF
3. **Pattern detection**: Detecta fechas, números de póliza, etc.
4. **Performance**: Caché y procesamiento optimizado

### ✅ **Robustez**
1. **Múltiples fallbacks**: Si un método falla, prueba otro
2. **No blocking**: Errores de imagen no detienen el procesamiento
3. **Better logging**: Logs detallados para debugging

## Próximos Pasos

1. **Inmediato**: Ejecutar `fix-pdf-deps.sh` y actualizar módulos
2. **Testing**: Probar con LOP.pdf y POLICY.pdf problemáticos
3. **Opcional**: Agregar OCR con Tesseract.js para PDFs escaneados
4. **Futuro**: Migrar completamente a PdfToolkitService

## Validación

Después de implementar, validar que:
- ✅ No hay errores de "API version does not match Worker version"
- ✅ LOP.pdf detecta firmas correctamente
- ✅ POLICY.pdf procesa completamente sin timeout
- ✅ El sistema continúa procesando aunque falle la conversión a imagen