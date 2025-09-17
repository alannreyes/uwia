const { execSync } = require('child_process');
const fs = require('fs');

console.log('🧪 TESTING POLICY.PDF OCR EXTRACTION...\n');

// Test 1: Verificar que el servicio esté corriendo
console.log('1️⃣ Verificando servicio...');
try {
  const status = execSync('curl -s http://localhost:3001/health || echo "OFFLINE"', { encoding: 'utf8' });
  if (status.includes('OFFLINE')) {
    console.log('❌ Servicio no está corriendo. Ejecuta: npm run start:dev');
    process.exit(1);
  }
  console.log('✅ Servicio activo');
} catch (error) {
  console.log('❌ Error verificando servicio:', error.message);
  process.exit(1);
}

// Test 2: Verificar archivo PDF
console.log('\n2️⃣ Verificando archivo...');
if (!fs.existsSync('docs/POLICY.pdf')) {
  console.log('❌ docs/POLICY.pdf no encontrado');
  process.exit(1);
}
const stats = fs.statSync('docs/POLICY.pdf');
console.log(`✅ POLICY.pdf: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

// Test 3: Probar extracción con timeout más corto
console.log('\n3️⃣ Iniciando test de extracción (timeout: 60s)...');
console.log('📋 Esperando respuesta del servidor...');

try {
  const command = `curl -s --max-time 60 -X POST http://localhost:3001/api/underwriting/v2/evaluate-claim -F "files=@docs/POLICY.pdf" -F "client_first_name=John" -F "client_last_name=Doe" -F "claim_number=12345" -F "policy_number=POL789" -F "date_of_loss=2024-01-15" -F "storm_date=2024-01-14"`;
  
  const result = execSync(command, { 
    encoding: 'utf8',
    timeout: 65000, // 65 seconds
    maxBuffer: 1024 * 1024 * 10 // 10MB buffer
  });
  
  console.log('\n📊 RESULTADO:');
  
  // Parse response
  try {
    const response = JSON.parse(result);
    console.log(`✅ Status: ${response.status}`);
    
    if (response.results && response.results['POLICY.pdf']) {
      const policyResult = response.results['POLICY.pdf'][0];
      console.log(`✅ Campo: ${policyResult.pmc_field}`);
      console.log(`✅ Respuesta: "${policyResult.answer}"`);
      console.log(`✅ Confianza: ${policyResult.confidence}`);
      
      if (policyResult.answer && policyResult.answer !== 'NOT_FOUND;NOT_FOUND;NOT_FOUND;NOT_FOUND;NO;NOT_FOUND;NO') {
        console.log('\n🎉 ¡OCR MEJORADO FUNCIONÓ! Se extrajo contenido real del PDF.');
      } else {
        console.log('\n⚠️  Aún retorna respuestas vacías - verificar logs del servidor');
      }
    }
    
  } catch (parseError) {
    console.log('📄 Respuesta (texto plano):');
    console.log(result.substring(0, 500) + '...');
  }
  
} catch (error) {
  if (error.message.includes('timeout')) {
    console.log('\n⏰ Timeout - El procesamiento está tomando más de 60 segundos');
    console.log('💡 Esto es normal para PDFs grandes con OCR. Verificar logs del servidor.');
  } else {
    console.log('\n❌ Error en la solicitud:', error.message);
  }
}

console.log('\n📋 PRÓXIMOS PASOS:');
console.log('1. Verificar logs del servidor para ver si OCR se activó correctamente');
console.log('2. Buscar líneas como "Detected large scanned document" en los logs');
console.log('3. Confirmar que se procesaron más de 3 páginas con OCR');