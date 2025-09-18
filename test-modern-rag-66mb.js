const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

async function testModernRAG66MB() {
  console.log('🧪 Testing Modern RAG 2025 with 66MB POLICY.pdf...');
  
  const policyPath = '/home/alann/proyectos/uwia/uwia/docs/POLICY64.pdf';
  
  // Verificar que el archivo existe
  if (!fs.existsSync(policyPath)) {
    console.error('❌ Policy file not found:', policyPath);
    return;
  }
  
  const stats = fs.statSync(policyPath);
  console.log(`📄 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  
  const form = new FormData();
  form.append('file', fs.createReadStream(policyPath));
  form.append('documentType', 'POLICY');
  
  const startTime = Date.now();
  
  try {
    console.log('🚀 Sending request to Gemini File API with Modern RAG...');
    
    const response = await fetch('http://localhost:5010/test-rag/modern-rag-test', {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });
    
    const endTime = Date.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Request failed:', response.status, errorText);
      return;
    }
    
    const result = await response.json();
    
    console.log(`✅ Request completed in ${processingTime} seconds`);
    console.log('\n📊 ANALYSIS RESULTS:');
    console.log('='.repeat(80));
    
    if (result.analysis) {
      console.log('Analysis received:', result.analysis.substring(0, 500) + '...');
      
      // Verificar formato correcto (debe contener semicolons)
      const hasSemicolons = result.analysis.includes(';');
      const isFormattedData = /\w+;\w+/.test(result.analysis);
      
      console.log('\n🔍 FORMAT VALIDATION:');
      console.log('Has semicolons:', hasSemicolons);
      console.log('Proper data format:', isFormattedData);
      
      if (hasSemicolons && isFormattedData) {
        console.log('✅ Response has proper semicolon-separated format!');
      } else {
        console.log('⚠️ Response format may need improvement');
      }
    }
    
    if (result.metadata) {
      console.log('\n📋 METADATA:');
      console.log('Strategy used:', result.metadata.strategy);
      console.log('Processing method:', result.metadata.processingMethod);
      console.log('Chunks processed:', result.metadata.chunksProcessed);
      console.log('Embedding used:', result.metadata.embeddingUsed);
    }
    
    console.log('\n🎯 Modern RAG 2025 test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Ejecutar test
testModernRAG66MB();