const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

async function testPolicy64WithNewLogic() {
  console.log('🧪 TEST POLICY64.PDF CON NUEVA LÓGICA DE DETECCIÓN');
  console.log('==================================================\n');
  
  const filePath = './docs/POLICY64.pdf';
  
  try {
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    console.log(`📄 Archivo: ${filePath}`);
    console.log(`📏 Tamaño: ${fileSizeMB.toFixed(2)} MB`);
    console.log('🎯 Esperado: Gemini File API (por detección de PDF escaneado)\n');
    
    // Preparar el request
    const form = new FormData();
    
    const testData = {
      carpeta_id: "999",
      record_id: "TEST-POLICY64-NEW-LOGIC",
      document_name: "POLICY",
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
    
    // Agregar campos al form
    Object.keys(testData).forEach(key => {
      form.append(key, testData[key]);
    });
    
    // Leer y agregar el archivo
    const fileBuffer = fs.readFileSync(filePath);
    form.append('file', fileBuffer, {
      filename: 'POLICY64.pdf',
      contentType: 'application/pdf'
    });
    
    console.log('📤 Enviando POLICY64.pdf al sistema...');
    console.log('⏱️ Esto puede tomar varios minutos...\n');
    
    const startTime = Date.now();
    
    const response = await axios.post('http://localhost:5010/api/underwriting/evaluate-claim', form, {
      headers: {
        ...form.getHeaders(),
      },
      timeout: 300000, // 5 minutos
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    const duration = Date.now() - startTime;
    const durationMin = (duration / 60000).toFixed(2);
    
    console.log(`✅ Respuesta recibida en ${duration}ms (${durationMin} minutos)`);
    
    // Analizar la respuesta
    const result = response.data;
    
    if (result.results && result.results['POLICY.pdf']) {
      const policyResult = result.results['POLICY.pdf'][0];
      const answer = policyResult.answer;
      const processingTime = policyResult.processing_time || policyResult.processing_time_ms;
      const method = policyResult.method || 'unknown';
      
      console.log('\n📊 RESULTADO DEL PROCESAMIENTO:');
      console.log('==============================');
      console.log(`🎯 Método usado: ${method}`);
      console.log(`⏱️ Tiempo de procesamiento: ${processingTime}ms`);
      console.log(`📝 Respuesta: ${answer}`);
      
      // Analizar la calidad de la respuesta
      const values = answer.split(';');
      const notFoundCount = values.filter(v => v.trim() === 'NOT_FOUND').length;
      const totalFields = values.length;
      const successRate = ((totalFields - notFoundCount) / totalFields * 100).toFixed(1);
      
      console.log('\n📈 ANÁLISIS DE CALIDAD:');
      console.log('=======================');
      console.log(`📋 Campos totales: ${totalFields}`);
      console.log(`✅ Campos encontrados: ${totalFields - notFoundCount}`);
      console.log(`❌ NOT_FOUND: ${notFoundCount}`);
      console.log(`📊 Tasa de éxito: ${successRate}%`);
      
      // Verificar si se usó el método correcto
      console.log('\n🔍 VERIFICACIÓN DEL MÉTODO:');
      console.log('===========================');
      
      if (method.includes('gemini') || method.includes('file-api')) {
        console.log('✅ CORRECTO: Se usó Gemini File API');
        console.log('📝 La nueva lógica de detección funcionó');
        
        if (parseFloat(successRate) > 30) {
          console.log('🎉 EXCELENTE: Mejor extracción de datos con Gemini');
        } else {
          console.log('⚠️ PARCIAL: Gemini File API funcionó pero datos limitados');
        }
      } else if (method.includes('modern-rag')) {
        console.log('❌ PROBLEMA: Aún usa Modern RAG para PDF escaneado');
        console.log('🔧 La lógica de detección necesita ajuste');
      } else {
        console.log(`❓ DESCONOCIDO: Método ${method} no identificado`);
      }
      
    } else {
      console.log('❌ No se encontraron resultados en la respuesta');
      console.log('📄 Respuesta completa:');
      console.log(JSON.stringify(result, null, 2));
    }
    
  } catch (error) {
    console.error('❌ Error durante la prueba:', error.message);
    
    if (error.response) {
      console.error(`📄 Status: ${error.response.status} ${error.response.statusText}`);
      if (error.response.data) {
        console.error('💾 Error data:', error.response.data);
      }
    }
    
    if (error.code === 'ECONNREFUSED') {
      console.error('🔌 El servidor no está ejecutándose en localhost:5010');
      console.error('🚀 Ejecuta: npm run start:dev');
    }
  }
}

// Solo ejecutar si el archivo existe
if (fs.existsSync('./docs/POLICY64.pdf')) {
  testPolicy64WithNewLogic().catch(console.error);
} else {
  console.error('❌ No se encontró el archivo ./docs/POLICY64.pdf');
  console.log('📁 Archivos disponibles en ./docs/:');
  try {
    const files = fs.readdirSync('./docs/').filter(f => f.endsWith('.pdf'));
    files.forEach(file => console.log(`   - ${file}`));
  } catch (e) {
    console.error('No se pudo listar el directorio docs/');
  }
}