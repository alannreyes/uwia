const fs = require('fs');
const path = require('path');

// Importar solo las partes que necesitamos para la detección (sin NestJS/DB)
const pdf = require('pdf-parse');

async function analyzePolicyDetection() {
  console.log('🔍 PRUEBA DE DETECCIÓN STANDALONE - POLICY64.pdf');
  console.log('================================================\n');
  
  const filePath = path.join(__dirname, 'docs', 'POLICY64.pdf');
  
  if (!fs.existsSync(filePath)) {
    console.error('❌ No se encontró POLICY64.pdf en docs/');
    return;
  }
  
  try {
    const buffer = fs.readFileSync(filePath);
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    console.log(`📄 Archivo: POLICY64.pdf`);
    console.log(`📏 Tamaño: ${fileSizeMB.toFixed(2)} MB`);
    console.log('⏱️ Analizando contenido...\n');
    
    // Análisis básico con pdf-parse
    const pdfData = await pdf(buffer);
    
    const totalPages = pdfData.numpages;
    const textContent = pdfData.text || '';
    const textLength = textContent.length;
    const charsPerMB = textLength / fileSizeMB;
    
    console.log('📊 ANÁLISIS DE CONTENIDO:');
    console.log('=========================');
    console.log(`📑 Páginas totales: ${totalPages}`);
    console.log(`🔤 Caracteres extraídos: ${textLength.toLocaleString()}`);
    console.log(`📈 Caracteres por MB: ${Math.round(charsPerMB).toLocaleString()}`);
    
    // Aplicar la nueva lógica de detección
    console.log('\n🎯 APLICANDO NUEVA LÓGICA DE DETECCIÓN:');
    console.log('======================================');
    
    // Condiciones de la nueva lógica
    const isLargeFile = fileSizeMB > 30;
    const hasLowTextDensity = charsPerMB < 100;
    const hasMinimalText = textLength < 1000;
    
    console.log(`📏 Es archivo grande (>30MB): ${isLargeFile ? '✅ SÍ' : '❌ NO'}`);
    console.log(`📝 Densidad de texto baja (<100 chars/MB): ${hasLowTextDensity ? '✅ SÍ' : '❌ NO'}`);
    console.log(`🔤 Texto mínimo (<1000 chars): ${hasMinimalText ? '✅ SÍ' : '❌ NO'}`);
    
    // Decisión final
    const shouldUseGeminiFileApi = isLargeFile || hasLowTextDensity || hasMinimalText;
    
    console.log('\n🚀 DECISIÓN DE ENRUTAMIENTO:');
    console.log('============================');
    if (shouldUseGeminiFileApi) {
      console.log('✅ USAR: Gemini File API');
      console.log('📝 RAZÓN: PDF detectado como escaneado o archivo grande');
    } else {
      console.log('✅ USAR: Modern RAG 2025');
      console.log('📝 RAZÓN: PDF con texto extraíble suficiente');
    }
    
    // Análisis de contenido específico
    console.log('\n🔍 ANÁLISIS DE CONTENIDO ESPECÍFICO:');
    console.log('===================================');
    
    const sampleText = textContent.substring(0, 500);
    console.log(`📄 Muestra de texto extraído (primeros 500 chars):`);
    console.log(`"${sampleText}"`);
    
    if (textLength < 50) {
      console.log('\n⚠️ ALERTA: Texto extraído muy limitado');
      console.log('📝 Confirmado: Es un PDF escaneado que requiere OCR');
    } else if (textLength < 1000) {
      console.log('\n🟡 ADVERTENCIA: Texto extraído limitado');
      console.log('📝 Posible: PDF parcialmente escaneado');
    } else {
      console.log('\n✅ BUENO: Texto extraído suficiente');
      console.log('📝 Posible: PDF con texto extraíble');
    }
    
    // Simular resultado esperado
    console.log('\n🎭 SIMULACIÓN DE RESULTADO ESPERADO:');
    console.log('===================================');
    if (shouldUseGeminiFileApi) {
      console.log('📊 Con Gemini File API se esperan mejores resultados');
      console.log('🔧 OCR avanzado puede extraer texto de imágenes');
      console.log('📈 Tasa de éxito esperada: 60-80%');
    } else {
      console.log('📊 Con Modern RAG 2025 debería funcionar bien');
      console.log('🔧 Análisis semántico de texto extraído');
      console.log('📈 Tasa de éxito esperada: 80-95%');
    }
    
  } catch (error) {
    console.error('❌ Error durante el análisis:', error.message);
  }
}

// Ejecutar análisis
analyzePolicyDetection().catch(console.error);