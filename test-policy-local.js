const fs = require('fs');
const path = require('path');

// Cargar variables de entorno del archivo .env.local
require('dotenv').config({ path: './.env.local' });

async function testPolicyProcessing() {
  console.log('🚀 Iniciando test de POLICY.pdf con GeminiFileApiService...');
  
  // Verificar configuración
  console.log('📋 Configuración:');
  console.log(`   - GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ No configurada'}`);
  console.log(`   - GEMINI_ENABLED: ${process.env.GEMINI_ENABLED}`);
  console.log(`   - PORT: ${process.env.PORT}`);
  
  try {
    // Importar el servicio
    const { GeminiFileApiService } = require('./dist/modules/underwriting/services/gemini-file-api.service');
    
    // Crear instancia del servicio
    const geminiService = new GeminiFileApiService();
    
    // Verificar si el servicio está habilitado
    if (!geminiService.isEnabled()) {
      console.log('❌ GeminiFileApiService no está habilitado');
      return;
    }
    
    // Leer el archivo POLICY.pdf
    const policyPath = path.join(__dirname, 'docs', 'POLICY.pdf');
    
    if (!fs.existsSync(policyPath)) {
      console.log('❌ Archivo POLICY.pdf no encontrado en docs/');
      return;
    }
    
    const policyBuffer = fs.readFileSync(policyPath);
    console.log(`📄 Archivo cargado: ${(policyBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    // Procesar el PDF
    console.log('🔄 Procesando PDF con Gemini File API...');
    
    const questions = [
      'What is the policy number?',
      'What is the policy holder name?',
      'What is the property address?',
      'What is the coverage amount?',
      'What is the deductible amount?'
    ];
    
    for (const question of questions) {
      console.log(`\n🔍 Pregunta: ${question}`);
      
      try {
        const result = await geminiService.processPdfDocument(policyBuffer, question);
        
        console.log(`   ✅ Respuesta: ${result.response}`);
        console.log(`   📊 Método: ${result.method}`);
        console.log(`   ⏱️  Tiempo: ${result.processingTime}ms`);
        console.log(`   🎯 Confianza: ${result.confidence}%`);
        
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error general:', error.message);
    console.error('Stack:', error.stack);
  }
}

testPolicyProcessing();