const fs = require('fs');
const path = require('path');

// Cargar variables de entorno del archivo .env.local
require('dotenv').config({ path: './.env.local' });

async function testPdfSplitting() {
  console.log('🔪 Iniciando test de división de PDF grande...');
  
  // Verificar configuración
  console.log('📋 Configuración:');
  console.log(`   - GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ No configurada'}`);
  console.log(`   - GEMINI_ENABLED: ${process.env.GEMINI_ENABLED}`);
  
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
    
    console.log('✅ GeminiFileApiService habilitado correctamente\n');
    
    // Probar POLICY64.pdf (el archivo grande)
    console.log(`${'='.repeat(80)}`);
    console.log(`🔪 PROBANDO DIVISIÓN DE PDF: POLICY64.pdf`);
    console.log(`${'='.repeat(80)}`);
    
    const filePath = path.join(__dirname, 'docs', 'POLICY64.pdf');
    
    if (!fs.existsSync(filePath)) {
      console.log(`❌ Archivo POLICY64.pdf no encontrado en docs/`);
      return;
    }
    
    const fileBuffer = fs.readFileSync(filePath);
    const fileSizeMB = (fileBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`📊 Tamaño: ${fileSizeMB} MB (excede límite de 50MB)`);
    
    // Lista de preguntas para probar
    const questions = [
      'What is the policy number?',
      'Who is the policy holder?',
      'What is the property address?',
      'What is the coverage amount?'
    ];
    
    console.log(`\n🔍 Probando con ${questions.length} preguntas diferentes...\n`);
    
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      console.log(`\n${'-'.repeat(60)}`);
      console.log(`❓ Pregunta ${i + 1}/${questions.length}: ${question}`);
      console.log(`${'-'.repeat(60)}`);
      
      try {
        const startTime = Date.now();
        const result = await geminiService.processPdfDocument(fileBuffer, question);
        const totalTime = Date.now() - startTime;
        
        console.log(`✅ ÉXITO en ${(totalTime / 1000).toFixed(1)}s`);
        console.log(`   📝 Respuesta: ${result.response.substring(0, 200)}${result.response.length > 200 ? '...' : ''}`);
        console.log(`   🔧 Método: ${result.method}`);
        console.log(`   ⏱️  Tiempo procesamiento: ${(result.processingTime / 1000).toFixed(1)}s`);
        console.log(`   🎯 Confianza: ${(result.confidence * 100).toFixed(1)}%`);
        console.log(`   🧠 Modelo: ${result.model}`);
        console.log(`   🔢 Tokens: ${result.tokensUsed}`);
        if (result.reasoning) {
          console.log(`   💭 Detalles: ${result.reasoning}`);
        }
        
      } catch (error) {
        console.log(`❌ ERROR: ${error.message}`);
        
        // Análisis del error
        if (error.message.includes('too large')) {
          console.log(`   📏 Tipo: Límite de tamaño`);
        } else if (error.message.includes('split')) {
          console.log(`   🔪 Tipo: Error en división`);
        } else {
          console.log(`   🔧 Tipo: Otro error`);
        }
      }
    }
    
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 TEST DE DIVISIÓN COMPLETADO');
    console.log(`${'='.repeat(80)}`);
    
  } catch (error) {
    console.error('❌ Error general:', error.message);
    console.error('Stack:', error.stack);
  }
}

testPdfSplitting();