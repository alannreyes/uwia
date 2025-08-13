import { Injectable, Logger } from '@nestjs/common';
const pdfParse = require('pdf-parse');

// Importar pdfjs-dist de forma segura (versión 3.x con CommonJS)
let pdfjs: any = null;

// Logging detallado para diagnóstico
console.log('🔍 Attempting to load pdfjs-dist...');
console.log('📁 Node version:', process.version);
console.log('🐧 Platform:', process.platform);
console.log('📦 NODE_ENV:', process.env.NODE_ENV);

try {
  // Verificar si el módulo existe
  console.log('📂 Checking module path...');
  const modulePath = require.resolve('pdfjs-dist/package.json');
  console.log('✅ pdfjs-dist package found at:', modulePath);
  
  // Intentar cargar el módulo principal
  console.log('📥 Loading main module...');
  pdfjs = require('pdfjs-dist/build/pdf');
  console.log('✅ Main module loaded successfully');
  console.log('🔧 Module type:', typeof pdfjs);
  console.log('🔍 Available methods:', Object.keys(pdfjs).slice(0, 5));
  
  // Configurar worker path local
  if (pdfjs && pdfjs.GlobalWorkerOptions) {
    console.log('⚙️ Configuring worker...');
    try {
      const workerPath = require.resolve('pdfjs-dist/build/pdf.worker');
      pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
      console.log(`🔧 Using local PDF worker: ${workerPath}`);
    } catch (workerError) {
      console.log('⚠️ Local worker not found, using CDN fallback');
      // Fallback a CDN
      pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version || '3.11.174'}/pdf.worker.min.js`;
      console.log(`🌐 Using CDN PDF worker (version: ${pdfjs.version})`);
    }
  } else {
    console.log('❌ GlobalWorkerOptions not available');
  }
  console.log(`✅ pdfjs-dist loaded successfully (version: ${pdfjs.version})`);
} catch (error) {
  console.error('❌ pdfjs-dist loading failed:');
  console.error('   Error name:', error.name);
  console.error('   Error message:', error.message);
  console.error('   Error stack:', error.stack?.split('\n').slice(0, 3).join('\n'));
  console.warn('⚠️ pdfjs-dist not available, fallback to pdf-parse only');
}

@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);

  async extractText(buffer: Buffer): Promise<string> {
    this.logger.log('Iniciando extracción de texto del PDF con múltiples métodos');
    
    // MÉTODO 1: pdf-parse (más simple, pero no extrae campos de formulario)
    let pdfParseText = '';
    try {
      this.logger.log('📄 Método 1: Usando pdf-parse para extracción básica');
      const data = await pdfParse(buffer);
      pdfParseText = data.text?.trim() || '';
      
      if (pdfParseText && pdfParseText.length > 0) {
        this.logger.log(`✅ pdf-parse extrajo: ${pdfParseText.length} caracteres`);
      }
    } catch (error) {
      this.logger.warn(`⚠️ pdf-parse falló: ${error.message}`);
    }

    // MÉTODO 2: pdfjs-dist (más robusto Y extrae campos de formulario)
    try {
      this.logger.log('📄 Método 2: Usando pdfjs-dist con extracción de campos de formulario');
      const pdfjsText = await this.extractWithPdfJs(buffer);
      
      if (pdfjsText && pdfjsText.length > 0) {
        this.logger.log(`✅ pdfjs-dist exitoso: ${pdfjsText.length} caracteres (incluyendo campos de formulario)`);
        
        // Si pdfjs-dist extrajo más texto que pdf-parse, usar pdfjs-dist
        // Esto indica que probablemente hay campos de formulario
        if (pdfjsText.length > pdfParseText.length || pdfjsText.includes('=== FORM FIELD VALUES ===')) {
          this.logger.log('🎯 Usando pdfjs-dist porque incluye campos de formulario o más contenido');
          return pdfjsText;
        }
      }
    } catch (error) {
      this.logger.warn(`⚠️ pdfjs-dist falló: ${error.message}`);
    }

    // MÉTODO 2.5: Análisis mejorado de pdf-parse para simular campos
    if (pdfParseText && pdfParseText.length > 0) {
      try {
        this.logger.log('📄 Método 2.5: Mejorando extracción con análisis de patrones');
        const enhancedText = await this.enhancePdfParseText(buffer, pdfParseText);
        if (enhancedText.length > pdfParseText.length) {
          this.logger.log(`✅ Texto mejorado: ${enhancedText.length} caracteres`);
          return enhancedText;
        }
      } catch (error) {
        this.logger.warn(`⚠️ Mejora de texto falló: ${error.message}`);
      }
    }

    // Si pdf-parse tuvo éxito y pdfjs-dist no agregó valor, usar pdf-parse
    if (pdfParseText && pdfParseText.length > 0) {
      this.logger.log('📄 Usando resultado de pdf-parse (no se detectaron campos de formulario)');
      return pdfParseText;
    }

    // MÉTODO 3: Análisis de metadatos (último recurso)
    try {
      this.logger.log('📄 Método 3: Extrayendo metadatos básicos');
      const basicInfo = await this.extractBasicInfo(buffer);
      
      if (basicInfo && basicInfo.length > 0) {
        this.logger.log(`✅ Metadatos extraídos: ${basicInfo.length} caracteres`);
        return basicInfo;
      }
    } catch (error) {
      this.logger.warn(`⚠️ Extracción de metadatos falló: ${error.message}`);
    }

    // Si todos los métodos fallan
    this.logger.error('❌ TODOS los métodos de extracción fallaron');
    throw new Error('No se pudo extraer texto del PDF con ningún método disponible');
  }

  async extractTextFromBase64(base64Content: string): Promise<string> {
    try {
      // Limpiar header de base64 si existe
      const cleanBase64 = base64Content.replace(/^data:application\/pdf;base64,/, '');
      
      // Convertir base64 a buffer
      const buffer = Buffer.from(cleanBase64, 'base64');
      
      // Detectar archivos grandes y aplicar timeout mayor
      const isLargeFile = buffer.length > 20971520; // 20MB
      const timeout = isLargeFile ? 
        parseInt(process.env.LARGE_FILE_TIMEOUT) || 300000 : // 5 min para grandes
        60000; // 1 min para normales
      
      this.logger.log(`PDF size: ${(buffer.length / 1048576).toFixed(2)}MB - Timeout: ${timeout/1000}s`);
      
      return await Promise.race([
        this.extractText(buffer),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`PDF processing timeout after ${timeout/1000}s`)), timeout)
        )
      ]);
    } catch (error) {
      this.logger.error('Error extrayendo texto de contenido base64:', error.message);
      throw new Error(`Error al procesar PDF desde base64: ${error.message}`);
    }
  }

  /**
   * MÉTODO 2: Extracción usando pdfjs-dist (más robusto)
   * Ahora también extrae valores de campos de formulario
   */
  private async extractWithPdfJs(buffer: Buffer): Promise<string> {
    if (!pdfjs) {
      throw new Error('pdfjs-dist not available');
    }
    
    try {
      const loadingTask = pdfjs.getDocument({
        data: buffer,
        useSystemFonts: true,
        disableFontFace: false,
        verbosity: 0
      });

      const pdf = await loadingTask.promise;
      let fullText = '';
      const formFields: { [key: string]: string } = {};

      // Primero intentar extraer campos de formulario AcroForm
      try {
        const formData = await pdf.getFieldObjects();
        if (formData && Object.keys(formData).length > 0) {
          this.logger.log(`📋 Encontrados ${Object.keys(formData).length} campos de formulario`);
          
          for (const [fieldName, fieldData] of Object.entries(formData)) {
            if (fieldData && Array.isArray(fieldData)) {
              for (const field of fieldData) {
                if (field && field.value !== undefined && field.value !== null && field.value !== '') {
                  formFields[fieldName] = String(field.value);
                  this.logger.log(`   ✓ Campo "${fieldName}": "${field.value}"`);
                }
              }
            }
          }
        }
      } catch (formError) {
        this.logger.warn(`⚠️ No se pudieron extraer campos de formulario: ${formError.message}`);
      }

      // Extraer texto de todas las páginas Y anotaciones
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          const page = await pdf.getPage(pageNum);
          
          // Extraer texto normal
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');
          
          if (pageText.trim()) {
            fullText += `${pageText}\n`;
          }

          // Extraer anotaciones (incluye campos de formulario)
          try {
            const annotations = await page.getAnnotations();
            if (annotations && annotations.length > 0) {
              this.logger.log(`📝 Página ${pageNum}: ${annotations.length} anotaciones encontradas`);
              
              for (const annotation of annotations) {
                // Procesar widgets de formulario (campos editables)
                if (annotation.subtype === 'Widget' || annotation.fieldType) {
                  const fieldName = annotation.fieldName || annotation.title || 'unnamed_field';
                  let fieldValue = '';

                  // Extraer valor según el tipo de campo
                  if (annotation.fieldValue !== undefined && annotation.fieldValue !== null) {
                    fieldValue = String(annotation.fieldValue);
                  } else if (annotation.buttonValue) {
                    fieldValue = annotation.buttonValue;
                  } else if (annotation.value) {
                    fieldValue = annotation.value;
                  } else if (annotation.defaultAppearance) {
                    // Algunos campos tienen el valor en defaultAppearance
                    const match = annotation.defaultAppearance.match(/\((.*?)\)/);
                    if (match && match[1]) {
                      fieldValue = match[1];
                    }
                  }

                  if (fieldValue && fieldValue.trim() !== '') {
                    formFields[fieldName] = fieldValue;
                    this.logger.log(`   ✓ Campo anotación "${fieldName}": "${fieldValue}" (tipo: ${annotation.fieldType || annotation.subtype})`);
                  }
                }
              }
            }
          } catch (annotError) {
            this.logger.warn(`⚠️ Error extrayendo anotaciones de página ${pageNum}: ${annotError.message}`);
          }
          
          // Cleanup de la página
          page.cleanup();
        } catch (pageError) {
          this.logger.warn(`⚠️ Error en página ${pageNum}: ${pageError.message}`);
          continue;
        }
      }

      // Combinar texto extraído con valores de campos de formulario
      let combinedText = fullText;
      
      if (Object.keys(formFields).length > 0) {
        this.logger.log(`✅ Total campos de formulario extraídos: ${Object.keys(formFields).length}`);
        
        // Agregar campos de formulario al final del texto de manera estructurada
        combinedText += '\n\n=== FORM FIELD VALUES ===\n';
        for (const [fieldName, fieldValue] of Object.entries(formFields)) {
          combinedText += `${fieldName}: ${fieldValue}\n`;
        }
        combinedText += '=== END FORM FIELDS ===\n';
      }

      // Cleanup del documento
      pdf.destroy();
      
      return combinedText.trim();
    } catch (error) {
      throw new Error(`pdfjs-dist extraction failed: ${error.message}`);
    }
  }

  /**
   * MÉTODO 2.5: Mejora el texto de pdf-parse con análisis de patrones
   * Busca campos que podrían estar llenados en formularios
   */
  private async enhancePdfParseText(buffer: Buffer, originalText: string): Promise<string> {
    try {
      // Analizar el PDF como string para buscar patrones de campos
      const pdfString = buffer.toString('latin1');
      let enhancedText = originalText;
      
      // Patrones comunes de campos de formulario
      const fieldPatterns = [
        // Campos con valores después de dos puntos
        /([A-Za-z\s]{2,20}):\s*([^\r\n]{1,50})/g,
        // Checkbox patterns
        /☑|☒|✓|✗|\[x\]|\[X\]|\[ \]/g,
        // Date patterns
        /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
        // Signature lines
        /_{3,}|signature|signed|date/gi,
        // Amount patterns
        /\$[\d,]+\.?\d*/g,
      ];
      
      const foundFields = new Map<string, string>();
      let patternMatches = 0;
      
      // Buscar patrones en el string crudo del PDF
      fieldPatterns.forEach((pattern, index) => {
        const matches = pdfString.match(pattern);
        if (matches && matches.length > 0) {
          patternMatches += matches.length;
          matches.forEach((match, i) => {
            if (match.trim().length > 0) {
              foundFields.set(`pattern_${index}_${i}`, match.trim());
            }
          });
        }
      });
      
      // Si encontramos patrones, agregarlos al texto
      if (foundFields.size > 0) {
        enhancedText += '\n\n=== EXTRACTED FORM PATTERNS ===\n';
        for (const [key, value] of foundFields) {
          enhancedText += `${key}: ${value}\n`;
        }
        enhancedText += '=== END FORM PATTERNS ===\n';
        
        this.logger.log(`📝 Encontrados ${foundFields.size} patrones de campos en PDF`);
      }
      
      return enhancedText;
    } catch (error) {
      this.logger.warn(`Error en análisis de patrones: ${error.message}`);
      return originalText;
    }
  }

  /**
   * MÉTODO 3: Extracción básica de metadatos (último recurso)
   */
  private async extractBasicInfo(buffer: Buffer): Promise<string> {
    try {
      // Intentar extraer información básica del PDF
      const pdfString = buffer.toString('latin1');
      
      // Buscar patrones comunes en PDFs
      const patterns = [
        /\/Title\s*\(([^)]+)\)/g,
        /\/Subject\s*\(([^)]+)\)/g,
        /\/Author\s*\(([^)]+)\)/g,
        /\/Creator\s*\(([^)]+)\)/g,
        /\/Producer\s*\(([^)]+)\)/g,
        // Buscar texto entre stream y endstream
        /stream\s*([\s\S]*?)\s*endstream/g,
        // Buscar BT...ET (text objects)
        /BT\s*([\s\S]*?)\s*ET/g
      ];

      let extractedInfo = '';
      
      patterns.forEach(pattern => {
        const matches = pdfString.match(pattern);
        if (matches) {
          matches.forEach(match => {
            const cleaned = match
              .replace(/\/\w+\s*\(/, '')
              .replace(/\)/, '')
              .replace(/stream\s*/, '')
              .replace(/\s*endstream/, '')
              .replace(/BT\s*/, '')
              .replace(/\s*ET/, '')
              .trim();
            
            if (cleaned && cleaned.length > 3) {
              extractedInfo += `${cleaned} `;
            }
          });
        }
      });

      return extractedInfo.trim();
    } catch (error) {
      throw new Error(`Basic info extraction failed: ${error.message}`);
    }
  }
}