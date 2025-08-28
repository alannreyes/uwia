import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFForm, PDFField, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown } from 'pdf-lib';

/**
 * Servicio dedicado a la extracción de campos de formularios PDF
 * Usa pdf-lib que es JavaScript puro y no requiere compilación nativa
 */
@Injectable()
export class PdfFormExtractorService {
  private readonly logger = new Logger(PdfFormExtractorService.name);

  /**
   * Extrae todos los campos de formulario y sus valores de un PDF
   */
  async extractFormFields(buffer: Buffer): Promise<{
    fields: Record<string, any>;
    text: string;
    metadata: Record<string, string>;
  }> {
    try {
      this.logger.log('🔍 Iniciando extracción de campos con pdf-lib...');
      
      // Cargar el documento PDF
      const pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        updateMetadata: false
      });

      const results = {
        fields: {} as Record<string, any>,
        text: '',
        metadata: {} as Record<string, string>
      };

      // Extraer metadatos
      results.metadata = {
        title: pdfDoc.getTitle() || '',
        author: pdfDoc.getAuthor() || '',
        subject: pdfDoc.getSubject() || '',
        producer: pdfDoc.getProducer() || '',
        creator: pdfDoc.getCreator() || '',
        pageCount: String(pdfDoc.getPageCount())
      };

      // Verificar si tiene formulario
      const form = pdfDoc.getForm();
      const fields = form.getFields();
      
      if (fields.length === 0) {
        this.logger.warn('⚠️ El PDF no contiene campos de formulario');
        return results;
      }

      this.logger.log(`✅ Encontrados ${fields.length} campos de formulario`);

      // Procesar cada campo
      for (const field of fields) {
        const fieldName = field.getName();
        let fieldValue: any = null;
        let fieldType = 'unknown';

        try {
          // Determinar tipo de campo y extraer valor
          if (field instanceof PDFTextField) {
            fieldType = 'text';
            fieldValue = field.getText() || '';
            
            // También intentar obtener el valor por otros métodos
            if (!fieldValue) {
              const widgets = field.acroField.getWidgets();
              for (const widget of widgets) {
                const appearanceText = this.extractAppearanceText(widget);
                if (appearanceText) {
                  fieldValue = appearanceText;
                  break;
                }
              }
            }
          } else if (field instanceof PDFCheckBox) {
            fieldType = 'checkbox';
            fieldValue = field.isChecked();
          } else if (field instanceof PDFRadioGroup) {
            fieldType = 'radio';
            fieldValue = field.getSelected() || '';
          } else if (field instanceof PDFDropdown) {
            fieldType = 'dropdown';
            fieldValue = field.getSelected()?.join(', ') || '';
          }

          // Guardar campo si tiene valor
          if (fieldValue !== null && fieldValue !== '' && fieldValue !== false) {
            results.fields[fieldName] = {
              type: fieldType,
              value: fieldValue,
              raw: String(fieldValue)
            };
            
            this.logger.log(`   ✓ Campo "${fieldName}" (${fieldType}): "${fieldValue}"`);
          }
        } catch (fieldError) {
          this.logger.warn(`   ⚠️ Error procesando campo "${fieldName}": ${fieldError.message}`);
        }
      }

      // Generar texto estructurado con los campos
      if (Object.keys(results.fields).length > 0) {
        results.text = this.generateStructuredText(results.fields, results.metadata);
      }

      this.logger.log(`✅ Extracción completa: ${Object.keys(results.fields).length} campos con valores`);
      return results;

    } catch (error) {
      this.logger.error(`❌ Error en pdf-lib: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrae texto de la apariencia visual del widget (para campos con renderizado custom)
   */
  private extractAppearanceText(widget: any): string {
    try {
      const normalAppearance = widget.dict.get('AP')?.dict?.get('N');
      if (!normalAppearance) return '';

      // Intentar extraer texto del stream de apariencia
      const stream = normalAppearance.getContentsString?.() || '';
      
      // Buscar patrones de texto en el stream
      const textMatches = stream.match(/\((.*?)\)/g);
      if (textMatches && textMatches.length > 0) {
        return textMatches
          .map(match => match.slice(1, -1)) // Quitar paréntesis
          .filter(text => text.trim().length > 0)
          .join(' ');
      }

      return '';
    } catch (error) {
      return '';
    }
  }

  /**
   * Genera texto estructurado con los campos extraídos
   */
  private generateStructuredText(fields: Record<string, any>, metadata: Record<string, string>): string {
    let text = '=== PDF FORM DATA ===\n\n';
    
    // Metadatos
    text += 'METADATA:\n';
    for (const [key, value] of Object.entries(metadata)) {
      if (value) {
        text += `  ${key}: ${value}\n`;
      }
    }
    
    text += '\nFORM FIELDS:\n';
    
    // Campos de formulario
    for (const [fieldName, fieldData] of Object.entries(fields)) {
      text += `  ${fieldName}:\n`;
      text += `    Type: ${fieldData.type}\n`;
      text += `    Value: ${fieldData.raw}\n`;
    }
    
    text += '\n=== END PDF FORM DATA ===\n';
    
    return text;
  }

  /**
   * Detecta si un PDF es un formulario rellenable o un documento estático
   */
  async detectPdfType(buffer: Buffer): Promise<{
    isForm: boolean;
    hasFilledFields: boolean;
    formFieldCount: number;
    filledFieldCount: number;
  }> {
    try {
      const pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        updateMetadata: false
      });

      const form = pdfDoc.getForm();
      const fields = form.getFields();
      
      let filledCount = 0;
      
      for (const field of fields) {
        let hasValue = false;
        
        if (field instanceof PDFTextField) {
          hasValue = !!(field.getText()?.trim());
        } else if (field instanceof PDFCheckBox) {
          hasValue = field.isChecked();
        } else if (field instanceof PDFRadioGroup) {
          hasValue = !!field.getSelected();
        } else if (field instanceof PDFDropdown) {
          hasValue = !!(field.getSelected()?.length);
        }
        
        if (hasValue) filledCount++;
      }

      return {
        isForm: fields.length > 0,
        hasFilledFields: filledCount > 0,
        formFieldCount: fields.length,
        filledFieldCount: filledCount
      };
      
    } catch (error) {
      this.logger.warn(`Error detectando tipo PDF: ${error.message}`);
      return {
        isForm: false,
        hasFilledFields: false,
        formFieldCount: 0,
        filledFieldCount: 0
      };
    }
  }
}