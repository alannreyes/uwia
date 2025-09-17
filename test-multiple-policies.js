const fs = require('fs');
const path = require('path');

// Cargar variables de entorno del archivo .env.local
require('dotenv').config({ path: './.env.local' });

async function testMultiplePolicyFiles() {
  console.log('🚀 Iniciando test de múltiples archivos POLICY...');
  
  // Verificar configuración
  console.log('📋 Configuración:');
  console.log(`   - GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ No configurada'}`);
  console.log(`   - GEMINI_ENABLED: ${process.env.GEMINI_ENABLED}`);
  
  const testFiles = [
    { name: 'POLICY11.pdf', description: '11MB escaneado' },
    { name: 'POLICY12.pdf', description: '12MB digital' },
    { name: 'POLICY64.pdf', description: '64MB escaneado' }
  ];

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
    
    // Probar cada archivo
    for (const testFile of testFiles) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📄 PROBANDO: ${testFile.name} (${testFile.description})`);
      console.log(`${'='.repeat(60)}`);
      
      const filePath = path.join(__dirname, 'docs', testFile.name);
      
      if (!fs.existsSync(filePath)) {
        console.log(`❌ Archivo ${testFile.name} no encontrado en docs/`);
        continue;
      }
      
      const fileBuffer = fs.readFileSync(filePath);
      const fileSizeMB = (fileBuffer.length / 1024 / 1024).toFixed(2);
      console.log(`📊 Tamaño real: ${fileSizeMB} MB`);
      
      // Determinar método esperado
      const shouldUseFileApi = fileBuffer.length > (20 * 1024 * 1024);
      const exceedsLimit = fileBuffer.length > (50 * 1024 * 1024);
      
      console.log(`🔍 Método esperado: ${shouldUseFileApi ? 'File API' : 'Inline API'}`);
      if (exceedsLimit) {
        console.log(`⚠️  Excede límite de 50MB del File API`);
      }
      
      // Test con una pregunta simple
      const question = 'What is the policy number?';
      console.log(`\n❓ Pregunta: ${question}`);
      
      try {
        const startTime = Date.now();
        const result = await geminiService.processPdfDocument(fileBuffer, question);
        const totalTime = Date.now() - startTime;
        
        console.log(`✅ ÉXITO en ${totalTime}ms`);
        console.log(`   📝 Respuesta: ${result.response}`);
        console.log(`   🔧 Método usado: ${result.method}`);
        console.log(`   ⏱️  Tiempo interno: ${result.processingTime}ms`);
        console.log(`   🎯 Confianza: ${result.confidence}%`);
        console.log(`   🧠 Modelo: ${result.model}`);
        
      } catch (error) {
        console.log(`❌ ERROR: ${error.message}`);
        
        // Clasificar tipo de error
        if (error.message.includes('too large to be read')) {
          console.log(`   📏 Causa: Archivo excede límite de Gemini File API (50MB)`);
        } else if (error.message.includes('Request contains an invalid argument')) {
          console.log(`   ⚙️  Causa: Problema en formato de request`);
        } else {
          console.log(`   🔧 Causa: ${error.message}`);
        }
      }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 RESUMEN DE PRUEBAS COMPLETADO');
    console.log(`${'='.repeat(60)}`);
    
  } catch (error) {
    console.error('❌ Error general:', error.message);
    console.error('Stack:', error.stack);
  }
}

testMultiplePolicyFiles();