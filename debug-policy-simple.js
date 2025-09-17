const fs = require('fs');
const path = require('path');

// Usar pdf-parse directamente como el sistema
async function debugPolicyWithPdfParse() {
  try {
    const pdfParse = require('pdf-parse');
    
    // Cargar el archivo POLICY.pdf
    const policyPath = path.join(__dirname, 'docs', 'POLICY.pdf');
    if (!fs.existsSync(policyPath)) {
      console.error('❌ POLICY.pdf not found in docs/');
      return;
    }
    
    const buffer = fs.readFileSync(policyPath);
    console.log(`📄 Loaded POLICY.pdf: ${buffer.length} bytes (${(buffer.length/1024/1024).toFixed(2)} MB)`);
    
    // Extraer con pdf-parse
    console.log('\n=== EXTRACCIÓN CON PDF-PARSE ===');
    const data = await pdfParse(buffer);
    
    console.log(`📄 Páginas detectadas: ${data.numpages}`);
    console.log(`📝 Texto extraído: ${data.text.length} caracteres`);
    console.log(`📊 Información: ${JSON.stringify(data.info)}`);
    
    if (data.text.length === 0) {
      console.log('🚨 EL PDF NO TIENE TEXTO EXTRAÍBLE CON PDF-PARSE - Es un PDF escaneado que necesita OCR');
    } else if (data.text.length < 1000) {
      console.log('⚠️ PDF tiene muy poco texto extraíble - puede necesitar OCR adicional');
      console.log(`Texto completo: "${data.text}"`);
    } else {
      console.log('✅ PDF tiene texto extraíble suficiente');
      console.log(`Primeros 500 chars: "${data.text.substring(0, 500)}..."`);
    }
    
    // Verificar qué tipo de PDF es
    console.log('\n=== ANÁLISIS DEL PDF ===');
    if (data.text.trim().length === 0) {
      console.log('📋 DIAGNÓSTICO: PDF escaneado (imagen) - 100% necesita OCR');
    } else if (data.text.length < 100) {
      console.log('📋 DIAGNÓSTICO: PDF híbrido - principalmente imágenes con poco texto');
    } else {
      console.log('📋 DIAGNÓSTICO: PDF con texto extraíble');
    }
    
  } catch (error) {
    console.error('❌ Error during extraction:', error.message);
  }
}

debugPolicyWithPdfParse();