const fs = require('fs');
const path = require('path');

// Simular la extracción de PDF usando pdfjs-dist
async function debugPolicyExtraction() {
  try {
    // Setup Node.js globals para pdfjs-dist
    global.DOMMatrix = require('dommatrix').DOMMatrix;
    
    // Cargar pdfjs-dist con el path correcto para v5.x
    const pdfjs = require('pdfjs-dist');
    
    // Cargar el archivo POLICY.pdf
    const policyPath = path.join(__dirname, 'docs', 'POLICY.pdf');
    if (!fs.existsSync(policyPath)) {
      console.error('❌ POLICY.pdf not found in docs/');
      return;
    }
    
    const buffer = fs.readFileSync(policyPath);
    console.log(`📄 Loaded POLICY.pdf: ${buffer.length} bytes (${(buffer.length/1024/1024).toFixed(2)} MB)`);
    
    // Convertir a Uint8Array
    const uint8Array = new Uint8Array(buffer);
    
    // Cargar documento PDF
    const loadingTask = pdfjs.getDocument({
      data: uint8Array,
    });
    
    const pdf = await loadingTask.promise;
    console.log(`📊 PDF loaded successfully: ${pdf.numPages} pages`);
    
    // Extraer texto página por página
    for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) { // Solo las primeras 5 páginas para debug
      console.log(`\n--- Página ${i} ---`);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(' ');
      
      console.log(`Contenido extraído: ${pageText.length} caracteres`);
      if (pageText.length > 0) {
        console.log(`Primeros 200 chars: "${pageText.substring(0, 200)}..."`);
      } else {
        console.log(`⚠️ Página ${i} está VACÍA - posiblemente es una imagen escaneada`);
      }
      
      page.cleanup();
    }
    
    // Verificar también con extracción completa
    console.log('\n--- Extracción completa ---');
    const allText = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(' ');
      allText.push(pageText);
      page.cleanup();
    }
    
    const fullText = allText.join('\n');
    console.log(`📝 Texto total extraído: ${fullText.length} caracteres`);
    
    if (fullText.length === 0) {
      console.log('🚨 EL PDF NO TIENE TEXTO EXTRAÍBLE - Es posiblemente un PDF escaneado que necesita OCR');
    } else if (fullText.length < 1000) {
      console.log('⚠️ PDF tiene muy poco texto - puede necesitar OCR adicional');
    } else {
      console.log('✅ PDF tiene texto extraíble suficiente');
    }
    
  } catch (error) {
    console.error('❌ Error during extraction:', error.message);
  }
}

debugPolicyExtraction();