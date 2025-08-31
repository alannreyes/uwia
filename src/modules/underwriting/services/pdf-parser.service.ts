import { Injectable, Logger } from '@nestjs/common';
import { PdfFormExtractorService } from './pdf-form-extractor.service';
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

  constructor(
    private readonly pdfFormExtractor: PdfFormExtractorService,
  ) {}

  async extractText(buffer: Buffer): Promise<string> {
    this.logger.log('Iniciando extracción de texto del PDF con múltiples métodos');
    
    // MÉTODO 0: pdf-lib (JavaScript puro, extrae campos de formulario)
    try {
      this.logger.debug('📄 Método 0: Usando pdf-lib para extracción de formularios');
      const formData = await this.pdfFormExtractor.extractFormFields(buffer);
      
      if (formData.text && formData.text.length > 0) {
        this.logger.log(`✅ pdf-lib exitoso: ${formData.text.length} caracteres con ${Object.keys(formData.fields).length} campos`);
        return formData.text;
      }
    } catch (error) {
      this.logger.warn(`⚠️ pdf-lib falló: ${error.message}`);
    }
    
    // MÉTODO 1: pdf-parse (más simple, pero no extrae campos de formulario)
    let pdfParseText = '';
    try {
      this.logger.debug('📄 Método 1: Usando pdf-parse para extracción básica');
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
      this.logger.debug('📄 Método 2: Usando pdfjs-dist con extracción de campos de formulario');
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
      // pdfjs-dist siempre falla con Buffer format - silenciar este error conocido
      if (!error.message.includes('Please provide binary data as `Uint8Array`')) {
        this.logger.warn(`⚠️ pdfjs-dist falló: ${error.message}`);
      }
    }

    // MÉTODO 2.5: Análisis mejorado de pdf-parse para simular campos
    if (pdfParseText && pdfParseText.length > 0) {
      try {
        this.logger.debug('📄 Método 2.5: Mejorando extracción con análisis de patrones');
        const enhancedText = await this.enhancePdfParseText(buffer, pdfParseText);
        if (enhancedText.length > pdfParseText.length) {
          this.logger.log(`✅ Texto mejorado: ${enhancedText.length} caracteres`);
          return enhancedText;
        }
      } catch (error) {
        this.logger.warn(`⚠️ Mejora de texto falló: ${error.message}`);
      }
    }

    // MÉTODO 2.5: Análisis mejorado de pdf-parse para detectar campos llenados
    if (pdfParseText && pdfParseText.length > 0) {
      try {
        this.logger.debug('📄 Método 2.5: Mejorando extracción con análisis de campos llenados');
        const enhancedText = await this.extractFilledFormFields(buffer, pdfParseText);
        if (enhancedText.length > pdfParseText.length) {
          this.logger.log(`✅ Texto mejorado: ${enhancedText.length} caracteres (${enhancedText.length - pdfParseText.length} caracteres adicionales de campos)`);
          return enhancedText;
        }
      } catch (error) {
        this.logger.warn(`⚠️ Mejora de texto falló: ${error.message}`);
      }
      
      this.logger.log('📄 Usando resultado de pdf-parse (no se detectaron campos de formulario adicionales)');
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
        parseInt(process.env.LARGE_FILE_TIMEOUT) || 480000 : // 8 min para grandes
        90000; // 1.5 min para normales
      
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
   * Detecta inteligentemente el tipo de PDF y qué método de extracción usar
   */
  async analyzePdfType(buffer: Buffer): Promise<{
    type: 'form' | 'document' | 'scanned' | 'unknown';
    confidence: number;
    analysis: {
      hasFormFields: boolean;
      formFieldCount: number;
      filledFieldCount: number;
      textExtractable: boolean;
      fileSize: number;
      suggestedMethod: 'form-extraction' | 'text-extraction' | 'ocr' | 'hybrid';
    };
  }> {
    this.logger.debug('🔍 Analizando tipo de PDF para optimizar extracción...');
    
    const analysis = {
      hasFormFields: false,
      formFieldCount: 0,
      filledFieldCount: 0,
      textExtractable: false,
      fileSize: buffer.length,
      suggestedMethod: 'text-extraction' as 'form-extraction' | 'text-extraction' | 'ocr' | 'hybrid'
    };

    let type: 'form' | 'document' | 'scanned' | 'unknown' = 'unknown';
    let confidence = 0;

    try {
      // Análisis con pdf-lib para detectar formularios
      const formAnalysis = await this.pdfFormExtractor.detectPdfType(buffer);
      analysis.hasFormFields = formAnalysis.isForm;
      analysis.formFieldCount = formAnalysis.formFieldCount;
      analysis.filledFieldCount = formAnalysis.filledFieldCount;

      // Prueba rápida de extracción de texto con pdf-parse
      try {
        const data = await pdfParse(buffer);
        const extractedText = data.text?.trim() || '';
        analysis.textExtractable = extractedText.length > 50; // Mínimo 50 caracteres para considerar extractable
        
        // Si tiene poco texto pero muchas páginas, probablemente escaneado
        if (data.numpages > 1 && extractedText.length < data.numpages * 100) {
          type = 'scanned';
          confidence = 0.8;
          analysis.suggestedMethod = 'ocr';
        }
      } catch (textError) {
        analysis.textExtractable = false;
      }

      // Clasificación basada en análisis
      if (analysis.hasFormFields && analysis.filledFieldCount > 0) {
        type = 'form';
        confidence = 0.95;
        analysis.suggestedMethod = 'form-extraction';
        this.logger.log(`📋 PDF de formulario: ${analysis.filledFieldCount}/${analysis.formFieldCount} campos llenados`);
      } else if (analysis.hasFormFields && analysis.filledFieldCount === 0) {
        type = 'form';
        confidence = 0.7;
        analysis.suggestedMethod = 'hybrid'; // Formulario vacío, usar texto + análisis de estructura
        this.logger.log(`📄 PDF de formulario vacío: ${analysis.formFieldCount} campos disponibles`);
      } else if (analysis.textExtractable) {
        type = 'document';
        confidence = 0.8;
        analysis.suggestedMethod = 'text-extraction';
        this.logger.debug(`📄 PDF de documento con texto extractable`);
      } else {
        type = 'scanned';
        confidence = 0.6;
        analysis.suggestedMethod = 'ocr';
        this.logger.log(`🖼️ PDF posiblemente escaneado - requiere OCR`);
      }

      this.logger.log(`✅ Análisis completo: ${type} (confianza: ${(confidence * 100).toFixed(0)}%) - Método: ${analysis.suggestedMethod}`);
      
      return { type, confidence, analysis };

    } catch (error) {
      this.logger.error(`❌ Error analizando PDF: ${error.message}`);
      return {
        type: 'unknown',
        confidence: 0,
        analysis: {
          ...analysis,
          suggestedMethod: 'text-extraction' // Fallback seguro
        }
      };
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
   * MÉTODO 2.5: Extrae campos de formulario llenados usando análisis binario avanzado
   * Busca valores en campos AcroForm directamente en el PDF binario
   */
  private async extractFilledFormFields(buffer: Buffer, originalText: string): Promise<string> {
    try {
      this.logger.log('🔍 Analizando estructura binaria del PDF para campos llenados...');
      
      // Analizar el PDF como string binario para buscar campos AcroForm
      const pdfString = buffer.toString('latin1');
      let enhancedText = originalText;
      const extractedFields = new Map<string, string>();
      
      // PASO 1: Buscar objetos de campo AcroForm
      const fieldObjectPattern = /\/T\s*\(([^)]+)\)[^}]*\/V\s*\(([^)]+)\)/g;
      let match;
      
      while ((match = fieldObjectPattern.exec(pdfString)) !== null) {
        const fieldName = match[1].trim();
        const fieldValue = match[2].trim();
        
        if (fieldName && fieldValue && fieldValue !== '') {
          extractedFields.set(fieldName, fieldValue);
          this.logger.log(`📝 Campo AcroForm encontrado: "${fieldName}" = "${fieldValue}"`);
        }
      }
      
      // PASO 2: Buscar patrones de campos de texto alternativos
      const altTextFieldPattern = /\/Subtype\s*\/Widget[^}]*\/T\s*\(([^)]+)\)[^}]*\/V\s*\(([^)]+)\)/g;
      while ((match = altTextFieldPattern.exec(pdfString)) !== null) {
        const fieldName = match[1].trim();
        const fieldValue = match[2].trim();
        
        if (fieldName && fieldValue && fieldValue !== '' && !extractedFields.has(fieldName)) {
          extractedFields.set(fieldName, fieldValue);
          this.logger.log(`📝 Campo Widget encontrado: "${fieldName}" = "${fieldValue}"`);
        }
      }
      
      // PASO 3: Buscar campos con codificación hexadecimal
      const hexFieldPattern = /\/T\s*<([^>]+)>[^}]*\/V\s*<([^>]+)>/g;
      while ((match = hexFieldPattern.exec(pdfString)) !== null) {
        try {
          const fieldName = this.decodeHexString(match[1]);
          const fieldValue = this.decodeHexString(match[2]);
          
          if (fieldName && fieldValue && fieldValue !== '' && !extractedFields.has(fieldName)) {
            extractedFields.set(fieldName, fieldValue);
            this.logger.log(`📝 Campo hex encontrado: "${fieldName}" = "${fieldValue}"`);
          }
        } catch (hexError) {
          // Ignorar errores de decodificación hex
        }
      }
      
      // PASO 4: Buscar valores entre objetos de campo y valores
      const valueStreamPattern = /\/FT\s*\/Tx[^}]*\/V\s*\(([^)]+)\)/g;
      while ((match = valueStreamPattern.exec(pdfString)) !== null) {
        const fieldValue = match[1].trim();
        
        if (fieldValue && fieldValue !== '') {
          const fieldKey = `text_field_${extractedFields.size}`;
          extractedFields.set(fieldKey, fieldValue);
          this.logger.log(`📝 Valor de texto encontrado: "${fieldValue}"`);
        }
      }
      
      // PASO 5: Si encontramos campos, agregarlos al texto
      if (extractedFields.size > 0) {
        enhancedText += '\n\n=== EXTRACTED FORM FIELD VALUES ===\n';
        
        for (const [fieldName, fieldValue] of extractedFields) {
          enhancedText += `FIELD_${fieldName}: ${fieldValue}\n`;
        }
        
        enhancedText += '=== END FORM FIELD VALUES ===\n';
        this.logger.log(`✅ Extraídos ${extractedFields.size} campos de formulario llenados`);
      } else {
        this.logger.log('⚠️ No se encontraron campos de formulario llenados');
      }
      
      return enhancedText;
    } catch (error) {
      this.logger.error(`❌ Error en extracción de campos: ${error.message}`);
      return originalText;
    }
  }

  /**
   * Decodifica strings hexadecimales en PDFs
   */
  private decodeHexString(hexString: string): string {
    try {
      let result = '';
      for (let i = 0; i < hexString.length; i += 2) {
        const hexChar = hexString.substr(i, 2);
        result += String.fromCharCode(parseInt(hexChar, 16));
      }
      return result;
    } catch (error) {
      return hexString; // Retornar original si falla
    }
  }

  /**
   * MÉTODO ANTIGUO: Mejora el texto de pdf-parse con análisis de patrones básicos
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