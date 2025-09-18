const fs = require('fs');

async function analyzePolicy64() {
  console.log('🔍 ANÁLISIS DETALLADO DE POLICY64.PDF');
  console.log('=====================================\n');
  
  const filePath = './docs/POLICY64.pdf';
  
  try {
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    console.log(`📄 Archivo: ${filePath}`);
    console.log(`📏 Tamaño: ${stats.size} bytes (${fileSizeMB.toFixed(2)} MB)`);
    console.log(`📅 Modificado: ${stats.mtime}\n`);
    
    // Leer el archivo para análisis
    const buffer = fs.readFileSync(filePath);
    
    // Análisis de header
    const header = buffer.slice(0, 10).toString();
    console.log(`📋 Header PDF: "${header}"`);
    
    // Convertir a string para análisis de contenido
    const content = buffer.toString('latin1');
    
    // Buscar indicadores clave
    const indicators = {
      hasImages: content.includes('/XObject') || content.includes('/Image'),
      hasText: content.includes('/Font') || content.includes('/Text'),
      hasStream: content.includes('stream'),
      hasFlate: content.includes('/FlateDecode'),
      hasJPEG: content.includes('/DCTDecode'),
      hasCCITT: content.includes('/CCITTFaxDecode'),
      hasOCR: content.includes('/OCR') || content.includes('OCG'),
      isScanned: false
    };
    
    // Contar páginas
    const pageMatches = content.match(/\/Type\s*\/Page[^s]/g) || [];
    const estimatedPages = pageMatches.length;
    
    // Buscar fuentes (indicador de texto real vs imágenes)
    const fontMatches = content.match(/\/Type\s*\/Font/g) || [];
    const fontCount = fontMatches.length;
    
    // Buscar objetos de imagen
    const imageMatches = content.match(/\/Type\s*\/XObject[\s\S]*?\/Subtype\s*\/Image/g) || [];
    const imageCount = imageMatches.length;
    
    // Determinar si es principalmente escaneado
    indicators.isScanned = imageCount > fontCount * 2;
    
    console.log('🔍 ANÁLISIS DE CONTENIDO:');
    console.log(`📄 Páginas detectadas: ${estimatedPages}`);
    console.log(`🔤 Fuentes encontradas: ${fontCount}`);
    console.log(`🖼️ Imágenes encontradas: ${imageCount}`);
    console.log(`📝 Contiene texto real: ${indicators.hasText ? 'SÍ' : 'NO'}`);
    console.log(`🖼️ Contiene imágenes: ${indicators.hasImages ? 'SÍ' : 'NO'}`);
    console.log(`🗜️ Usa compresión Flate: ${indicators.hasFlate ? 'SÍ' : 'NO'}`);
    console.log(`📷 Usa compresión JPEG: ${indicators.hasJPEG ? 'SÍ' : 'NO'}`);
    console.log(`📠 Usa compresión CCITT: ${indicators.hasCCITT ? 'SÍ' : 'NO'}`);
    console.log(`📄 Parece escaneado: ${indicators.isScanned ? 'SÍ' : 'NO'}\n`);
    
    // Análisis de densidad de texto
    const textDensity = fontCount / estimatedPages;
    console.log(`📊 Densidad de texto: ${textDensity.toFixed(2)} fuentes por página`);
    
    // Determinar complejidad
    let complexity = 'BAJA';
    if (estimatedPages > 50 && fileSizeMB > 50) complexity = 'MUY ALTA';
    else if (estimatedPages > 30 || fileSizeMB > 30) complexity = 'ALTA';
    else if (estimatedPages > 15 || fileSizeMB > 15) complexity = 'MEDIA';
    
    console.log(`🎯 Complejidad del documento: ${complexity}\n`);
    
    // RECOMENDACIONES ESPECÍFICAS
    console.log('💡 RECOMENDACIONES DE PROCESAMIENTO:');
    console.log('=====================================\n');
    
    if (indicators.isScanned || textDensity < 1) {
      console.log('📋 DIAGNÓSTICO: PDF basado en imágenes/escaneado');
      console.log('🎯 MÉTODOS RECOMENDADOS (en orden de prioridad):');
      console.log('   1. ✅ Gemini File API Directo - ÓPTIMO para OCR de imágenes');
      console.log('   2. 🔄 PDF Splitting + Gemini - Para archivos muy grandes');
      console.log('   3. ⚠️ Modern RAG 2025 - Limitado sin texto extraíble');
      console.log('');
      console.log('📝 RAZÓN: Archivos escaneados requieren OCR avanzado');
      console.log('   - Gemini tiene mejor OCR que PDF.js');
      console.log('   - Modern RAG funciona mejor con texto extraíble');
    } else if (fileSizeMB > 50) {
      console.log('📋 DIAGNÓSTICO: PDF grande con texto extraíble');
      console.log('🎯 MÉTODOS RECOMENDADOS (en orden de prioridad):');
      console.log('   1. ✅ Modern RAG 2025 - ÓPTIMO para documentos grandes');
      console.log('   2. 🔄 PDF Splitting - Alternativa si RAG falla');
      console.log('   3. ⚠️ Gemini File API - Puede tener límites de tamaño');
    } else {
      console.log('📋 DIAGNÓSTICO: PDF mediano con texto');
      console.log('🎯 MÉTODOS RECOMENDADOS:');
      console.log('   1. ✅ Gemini File API Directo');
      console.log('   2. ✅ Modern RAG 2025');
    }
    
    console.log('\n🛠️ CONFIGURACIONES SUGERIDAS:');
    console.log('=============================\n');
    
    if (indicators.isScanned) {
      console.log('Para Gemini File API Directo:');
      console.log('- Usar modelo: gemini-1.5-pro-latest');
      console.log('- Prompt enfocado en OCR y extracción');
      console.log('- Timeout extendido (5+ minutos)');
      console.log('- Procesar por chunks si > 50MB\n');
    }
    
    console.log('Para Modern RAG 2025:');
    console.log('- Chunk size: 16384 bytes (más pequeño para imágenes)');
    console.log('- Embedding model: text-embedding-004');
    console.log('- Top-K chunks: 8-10');
    console.log('- Similarity threshold: 0.6\n');
    
    console.log('Para PDF Splitting:');
    console.log('- Chunk size: 30-40MB por archivo');
    console.log('- Procesar en paralelo: 2-3 chunks máximo');
    console.log('- Consolidar resultados al final\n');
    
    // Mostrar thresholds actuales del sistema
    console.log('⚙️ THRESHOLDS ACTUALES DEL SISTEMA:');
    console.log('===================================');
    console.log('- File API threshold: 20MB');
    console.log('- Modern RAG threshold: 30MB');
    console.log('- PDF Splitting threshold: 50MB');
    console.log(`- POLICY64.pdf (${fileSizeMB.toFixed(2)}MB): Usa Modern RAG 2025\n`);
    
    // Recomendación final
    console.log('🎯 RECOMENDACIÓN FINAL PARA POLICY64.PDF:');
    console.log('=========================================');
    
    if (indicators.isScanned) {
      console.log('❗ CAMBIAR A: Gemini File API Directo');
      console.log('📝 RAZÓN: Es un PDF escaneado que necesita OCR avanzado');
      console.log('🔧 ACCIÓN: Modificar threshold o forzar método Gemini');
    } else {
      console.log('✅ MANTENER: Modern RAG 2025');
      console.log('📝 RAZÓN: Tiene texto extraíble, RAG debería funcionar');
      console.log('🔧 ACCIÓN: Mejorar prompts y chunk processing');
    }
    
  } catch (error) {
    console.error('❌ Error analizando el archivo:', error.message);
  }
}

analyzePolicy64().catch(console.error);