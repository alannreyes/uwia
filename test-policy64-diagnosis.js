const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

async function testPolicy64Methods() {
  console.log('🔍 DIAGNÓSTICO COMPLETO POLICY64.PDF');
  console.log('=====================================');
  
  const filePath = './docs/POLICY64.pdf';
  const stats = fs.statSync(filePath);
  const fileSizeMB = stats.size / (1024 * 1024);
  
  console.log(`📄 Archivo: ${filePath}`);
  console.log(`📏 Tamaño: ${stats.size} bytes (${fileSizeMB.toFixed(2)} MB)`);
  console.log('');
  
  // Test data for the request
  const testData = {
    carpeta_id: "999",
    record_id: "TEST-POLICY64",
    document_name: "POLICY",
    context: JSON.stringify({
      insured_name: "TEST USER",
      insurance_company: "TEST INSURANCE",
      insured_address: "123 Test St, Test City, FL 12345",
      insured_street: "123 Test St",
      insured_city: "Test City", 
      insured_zip: "12345",
      date_of_loss: "04-11-25",
      policy_number: "TEST123",
      claim_number: "CLAIM123",
      type_of_job: "Dryout,Tarp,Retarp",
      cause_of_loss: "Wind"
    })
  };
  
  console.log('🎯 MÉTODO 1: ENVÍO DIRECTO AL SISTEMA ACTUAL');
  console.log('============================================');
  
  try {
    const form = new FormData();
    Object.keys(testData).forEach(key => {
      form.append(key, testData[key]);
    });
    
    // Leer el archivo
    const fileBuffer = fs.readFileSync(filePath);
    form.append('file', fileBuffer, {
      filename: 'POLICY64.pdf',
      contentType: 'application/pdf'
    });
    
    console.log('📤 Enviando POLICY64.pdf al sistema...');
    const startTime = Date.now();
    
    const response = await axios.post('http://localhost:5045/api/underwriting/evaluate-claim', form, {
      headers: {
        ...form.getHeaders(),
      },
      timeout: 300000, // 5 minutos
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    const duration = Date.now() - startTime;
    console.log(`✅ Respuesta recibida en ${duration}ms`);
    console.log('📊 RESULTADO:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Analizar la respuesta
    const result = response.data;
    if (result.results && result.results['POLICY.pdf']) {
      const answer = result.results['POLICY.pdf'][0].answer;
      const values = answer.split(';');
      const notFoundCount = values.filter(v => v.trim() === 'NOT_FOUND').length;
      const totalFields = values.length;
      const successRate = ((totalFields - notFoundCount) / totalFields * 100).toFixed(1);
      
      console.log('');
      console.log('📈 ANÁLISIS DEL RESULTADO:');
      console.log(`   - Campos totales: ${totalFields}`);
      console.log(`   - Campos encontrados: ${totalFields - notFoundCount}`);
      console.log(`   - NOT_FOUND: ${notFoundCount}`);
      console.log(`   - Tasa de éxito: ${successRate}%`);
      console.log(`   - Método usado: ${result.results['POLICY.pdf'][0].method || 'unknown'}`);
      console.log(`   - Tiempo de procesamiento: ${result.results['POLICY.pdf'][0].processing_time || 'unknown'}ms`);
      
      if (successRate < 30) {
        console.log('❌ BAJA TASA DE ÉXITO - El archivo requiere un método diferente');
      } else if (successRate < 70) {
        console.log('⚠️ TASA MODERADA - El método funciona parcialmente');
      } else {
        console.log('✅ ALTA TASA DE ÉXITO - El método actual funciona bien');
      }
    }
    
  } catch (error) {
    console.error('❌ Error en método 1:', error.message);
    if (error.response) {
      console.error('📄 Respuesta del servidor:', error.response.status, error.response.statusText);
      if (error.response.data) {
        console.error('💾 Datos de error:', error.response.data);
      }
    }
  }
  
  console.log('\n🔬 MÉTODO 2: ANÁLISIS DE CARACTERÍSTICAS DEL PDF');
  console.log('===============================================');
  
  try {
    // Leer los primeros bytes para analizar el PDF
    const buffer = fs.readFileSync(filePath);
    console.log(`📋 Tamaño del buffer: ${buffer.length} bytes`);
    
    // Verificar header PDF
    const header = buffer.slice(0, 8).toString();
    console.log(`📄 Header PDF: ${header}`);
    
    // Buscar indicadores de PDF basado en imágenes
    const content = buffer.toString('latin1');
    const hasImages = content.includes('/XObject') || content.includes('/Image');
    const hasText = content.includes('/Font') || content.includes('/Text');
    const hasStream = content.includes('stream');
    
    console.log(`🖼️ Contiene imágenes: ${hasImages ? 'SÍ' : 'NO'}`);
    console.log(`📝 Contiene texto: ${hasText ? 'SÍ' : 'NO'}`);
    console.log(`🌊 Contiene streams: ${hasStream ? 'SÍ' : 'NO'}`);
    
    // Contar páginas aproximadamente
    const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
    const estimatedPages = pageMatches ? pageMatches.length : 0;
    console.log(`📄 Páginas estimadas: ${estimatedPages}`);
    
    // Determinar complejidad
    const complexity = estimatedPages > 50 ? 'ALTA' : estimatedPages > 20 ? 'MEDIA' : 'BAJA';
    console.log(`🎯 Complejidad estimada: ${complexity}`);
    
    // Recomendación de método
    console.log('\n💡 RECOMENDACIONES:');
    
    if (fileSizeMB > 50 && estimatedPages > 30) {
      console.log('📋 1. Modern RAG 2025 (actual) - Para archivos muy grandes con muchas páginas');
      console.log('📋 2. PDF Splitting - Dividir en chunks de 40MB y procesar por separado');
      console.log('📋 3. Gemini File API Direct - Si el contenido es principalmente imágenes');
    } else if (fileSizeMB > 30) {
      console.log('📋 1. Gemini File API Direct - Recomendado para archivos medianos');
      console.log('📋 2. Modern RAG 2025 - Alternativa con embeddings');
    } else {
      console.log('📋 1. File API estándar - Para archivos de este tamaño');
    }
    
  } catch (error) {
    console.error('❌ Error en análisis del PDF:', error.message);
  }
  
  console.log('\n🧪 MÉTODO 3: TEST DIRECTO GEMINI FILE API');
  console.log('=========================================');
  
  // Crear un test directo con Gemini
  console.log('ℹ️ Para probar Gemini File API directamente, necesitarías:');
  console.log('1. Una API key válida de Gemini');
  console.log('2. Subir el archivo usando GoogleAIFileManager');
  console.log('3. Procesar con un prompt específico');
  console.log('');
  console.log('📝 Comando sugerido para test manual:');
  console.log('node test-gemini-direct-policy64.js');
  
  console.log('\n📊 RESUMEN DE DIAGNÓSTICO COMPLETO');
  console.log('==================================');
  console.log(`📄 Archivo: POLICY64.pdf (${fileSizeMB.toFixed(2)} MB)`);
  console.log('🎯 Método actual: Modern RAG 2025');
  console.log('📋 Estado: Funcionando pero con baja extracción de datos');
  console.log('💡 Recomendación: Evaluar PDF splitting o Gemini File API directo');
}

// Ejecutar el diagnóstico
testPolicy64Methods().catch(console.error);