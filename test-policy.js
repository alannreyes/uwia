// Test POLICY.pdf con el sistema ultra-agresivo
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

async function testPolicyPdf() {
  console.log('🚀 Iniciando test de POLICY.pdf con sistema ULTRA-AGRESIVO...\n');
  
  const form = new FormData();
  form.append('record_id', '12345');
  
  // Buscar POLICY.pdf en el directorio de test
  const policyPath = path.join(__dirname, 'test-documents', 'POLICY.pdf');
  
  if (!fs.existsSync(policyPath)) {
    console.error('❌ POLICY.pdf no encontrado en:', policyPath);
    return;
  }
  
  form.append('documents', fs.createReadStream(policyPath), 'POLICY.pdf');
  
  try {
    const startTime = Date.now();
    
    const response = await axios.post(
      'http://localhost:5035/api/underwriting/evaluate-claim',
      form,
      {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 120000
      }
    );
    
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Analizar resultados de POLICY.pdf
    const policyResults = response.data.results['POLICY.pdf'];
    
    if (!policyResults || policyResults.length === 0) {
      console.error('❌ No se recibieron resultados para POLICY.pdf');
      return;
    }
    
    const result = policyResults[0];
    const values = result.answer.split(';');
    const notFoundCount = values.filter(v => v === 'NOT_FOUND').length;
    const extractedCount = values.length - notFoundCount;
    const extractionRate = ((extractedCount / values.length) * 100).toFixed(1);
    
    console.log('📊 RESULTADOS POLICY.pdf - SISTEMA ULTRA-AGRESIVO:');
    console.log('═══════════════════════════════════════════════════');
    console.log(`✅ Campos totales: ${values.length}`);
    console.log(`✅ Campos extraídos: ${extractedCount}`);
    console.log(`❌ NOT_FOUND: ${notFoundCount}`);
    console.log(`📈 Tasa de extracción: ${extractionRate}%`);
    console.log(`⏱️ Tiempo de procesamiento: ${elapsedTime}s`);
    console.log(`🎯 Confianza: ${(result.confidence * 100).toFixed(1)}%`);
    console.log('═══════════════════════════════════════════════════\n');
    
    // Mostrar valores extraídos
    console.log('📝 VALORES EXTRAÍDOS:');
    values.forEach((value, index) => {
      const icon = value === 'NOT_FOUND' ? '❌' : '✅';
      console.log(`  ${icon} Campo ${index + 1}: ${value}`);
    });
    
    console.log('\n🏆 RESUMEN FINAL:');
    if (notFoundCount === 0) {
      console.log('🎉 ¡EXTRACCIÓN PERFECTA! 100% de campos extraídos');
    } else if (extractionRate >= 80) {
      console.log('✅ Extracción exitosa con alta tasa de éxito');
    } else if (extractionRate >= 60) {
      console.log('⚠️ Extracción moderada, algunos campos no encontrados');
    } else {
      console.log('❌ Baja tasa de extracción, revisar documento o prompts');
    }
    
    // Comparar con resultados anteriores (si los hay)
    console.log('\n📊 COMPARACIÓN CON SISTEMA ANTERIOR:');
    console.log('  Antes: ~60% extracción (estimado)');
    console.log(`  Ahora: ${extractionRate}% extracción`);
    console.log(`  Mejora: +${(parseFloat(extractionRate) - 60).toFixed(1)}% puntos`);
    
  } catch (error) {
    console.error('❌ Error en test:', error.message);
    if (error.response) {
      console.error('Detalles:', error.response.data);
    }
  }
}

// Ejecutar test
testPolicyPdf().catch(console.error);