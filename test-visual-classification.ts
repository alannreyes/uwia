import { OpenAiService } from './src/modules/underwriting/services/openai.service';

async function testVisualClassification() {
  console.log('🧪 Testing Visual Classification with AI\n');
  
  const testCases = [
    // Casos que SÍ requieren análisis visual
    { field: 'lop_signed_by_ho1', question: 'Is the Letter of Protection signed by the homeowner?', expected: true },
    { field: 'lop_signed_by_client1', question: 'Is the document signed by the client?', expected: true },
    { field: 'signed_insured_next_amount', question: 'Is there a signature next to the amount field?', expected: true },
    { field: 'homeowner_signature', question: 'Does the document have the homeowner signature?', expected: true },
    { field: 'stamp_present', question: 'Is there an official stamp on the document?', expected: true },
    { field: 'checkbox_marked', question: 'Are the required checkboxes marked?', expected: true },
    
    // Casos que NO requieren análisis visual
    { field: 'policy_number', question: 'What is the policy number?', expected: false },
    { field: 'claim_amount', question: 'What is the total claim amount?', expected: false },
    { field: 'date_of_loss', question: 'What is the date of loss?', expected: false },
    { field: 'insured_name', question: 'What is the name of the insured?', expected: false },
    { field: 'street_address', question: 'What is the property address?', expected: false },
  ];

  const service = new OpenAiService();
  let correct = 0;
  let total = testCases.length;

  for (const testCase of testCases) {
    try {
      console.log(`\n📋 Testing: ${testCase.field}`);
      console.log(`   Question: ${testCase.question}`);
      console.log(`   Expected: ${testCase.expected ? '✅ Visual' : '📄 Text'}`);
      
      const result = await service.classifyVisualRequirement(testCase.field, testCase.question);
      
      console.log(`   Result: ${result.requiresVisual ? '✅ Visual' : '📄 Text'}`);
      console.log(`   Reason: ${result.reason}`);
      
      if (result.requiresVisual === testCase.expected) {
        console.log(`   ✅ CORRECT`);
        correct++;
      } else {
        console.log(`   ❌ INCORRECT`);
      }
    } catch (error) {
      console.log(`   ⚠️ ERROR: ${error.message}`);
    }
  }

  console.log(`\n\n📊 Results: ${correct}/${total} correct (${Math.round(correct/total*100)}%)`);
  
  if (correct === total) {
    console.log('🎉 All tests passed!');
  } else {
    console.log(`⚠️ ${total - correct} tests failed`);
  }
}

// Run if executed directly
if (require.main === module) {
  testVisualClassification()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

export { testVisualClassification };