const fs = require('fs');

// Script para probar POLICY64.pdf directamente con Gemini File API
// Esto simula lo que debería hacer el sistema

async function testGeminiDirectWithPolicy64() {
  console.log('🧪 TEST DIRECTO GEMINI FILE API CON POLICY64.PDF');
  console.log('================================================\n');
  
  const filePath = './docs/POLICY64.pdf';
  const stats = fs.statSync(filePath);
  const fileSizeMB = stats.size / (1024 * 1024);
  
  console.log(`📄 Archivo: ${filePath}`);
  console.log(`📏 Tamaño: ${fileSizeMB.toFixed(2)} MB`);
  console.log('🎯 Método: Gemini File API Directo (sin Modern RAG)\n');
  
  // Crear el request específico para forzar Gemini File API
  const testPayload = {
    carpeta_id: "999",
    record_id: "TEST-POLICY64-DIRECT",
    document_name: "POLICY",
    // Agregamos un flag especial para forzar método
    force_gemini_file_api: true,
    context: JSON.stringify({
      insured_name: "NELSON ZAMOT",
      insurance_company: "STATE FARM",
      insured_address: "123 Test St, Spring Hill, FL 34609",
      insured_street: "123 Test St",
      insured_city: "Spring Hill",
      insured_zip: "34609",
      date_of_loss: "04-11-25",
      policy_number: "12345678",
      claim_number: "CLAIM789",
      type_of_job: "Dryout,Tarp,Retarp",
      cause_of_loss: "Wind"
    })
  };
  
  console.log('💡 PROPUESTA DE MODIFICACIÓN AL SISTEMA:');
  console.log('=========================================');
  console.log('1. Detectar archivos escaneados automáticamente');
  console.log('2. Para archivos sin texto extraíble, usar Gemini File API');
  console.log('3. Para archivos > 50MB escaneados, usar PDF Splitting + Gemini\n');
  
  console.log('🔧 CÓDIGO SUGERIDO PARA MODIFICAR:');
  console.log('==================================');
  console.log(`
// En shouldUseGeminiFileApi() function:
const hasExtractableText = await this.checkExtractableText(pdfBuffer);
const isScanned = !hasExtractableText;

if (isScanned) {
  this.logger.log('🔍 [DETECTION] Scanned PDF detected - forcing Gemini File API');
  return true; // Forzar Gemini para PDFs escaneados
}
`);
  
  console.log('📝 IMPLEMENTACIÓN SUGERIDA:');
  console.log('===========================');
  console.log('Archivo: src/modules/underwriting/underwriting.service.ts');
  console.log('Función: shouldUseGeminiFileApi()');
  console.log('Lógica: Si density de texto < 0.5 → usar Gemini File API\n');
  
  console.log('⚡ IMPLEMENTACIÓN INMEDIATA:');
  console.log('===========================');
  console.log('Puedo modificar el código ahora para que POLICY64.pdf');
  console.log('use Gemini File API en lugar de Modern RAG.\n');
  
  console.log('¿Quieres que implemente el fix ahora? (Y/N)');
  console.log('Esto modificará la lógica de detección para PDFs escaneados.');
}

testGeminiDirectWithPolicy64().catch(console.error);