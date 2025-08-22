import { AdaptiveProcessingStrategyService } from './src/modules/underwriting/services/adaptive-processing-strategy.service';
import { openaiConfig } from './src/config/openai.config';

async function testSignatureDetection() {
  console.log('🧪 Testing Signature Field Detection\n');
  
  const adaptiveStrategy = new AdaptiveProcessingStrategyService();
  
  // Test casos específicos de campos de firma del LOP.pdf
  const signatureFields = [
    {
      pmcField: 'lop_signed_by_ho1',
      question: 'Determine if a client, customer, homeowner, or property owner has signed this document. Look for any signatures, printed names, or dates in areas designated for the client, homeowner, customer, or property owner. Check signature blocks and signature lines for evidence of client signature. Answer YES if there is evidence of client/homeowner signature, NO if the client section appears blank or unsigned.',
      expectedType: 'boolean'
    },
    {
      pmcField: 'lop_signed_by_client1', 
      question: 'Determine if a service provider, contractor, or company representative has signed this document. Look for any signatures, printed names, or dates in areas designated for the service provider, contractor, company, or vendor. Check signature blocks, signature lines, or any area where a business representative would sign. Answer YES if there is evidence of provider/contractor signature, NO if the provider section appears blank or unsigned.',
      expectedType: 'boolean'
    },
    {
      pmcField: 'signed_insured_next_amount',
      question: 'Look for a homeowner or client signature that is specifically associated with approving or accepting a total amount, estimate total, or financial figure. The signature should be clearly connected to accepting the amount through proximity, signature lines, or approval sections. Answer YES only if there is a signature that appears to be approving or accepting a monetary amount, NO if signatures are for other purposes or not amount-related.',
      expectedType: 'boolean'
    }
  ];
  
  console.log(`🔧 OpenAI Config Status:`);
  console.log(`   - Enabled: ${openaiConfig.enabled}`);
  console.log(`   - Has API Key: ${!!openaiConfig.apiKey}`);
  console.log(`   - Model: ${openaiConfig.model}`);
  console.log(`   - Validation Model: ${openaiConfig.validationModel}`);
  console.log();
  
  for (const field of signatureFields) {
    try {
      console.log(`📋 Testing Field: ${field.pmcField}`);
      console.log(`   Question: ${field.question.substring(0, 100)}...`);
      
      const strategy = await adaptiveStrategy.determineStrategy(
        field.pmcField,
        field.question,
        field.expectedType as any,
        true // documentHasImages = true
      );
      
      console.log(`   ✅ Strategy Result:`);
      console.log(`      - Visual Analysis: ${strategy.useVisualAnalysis ? '🎯 YES' : '❌ NO'}`);
      console.log(`      - Dual Validation: ${strategy.useDualValidation ? '✅ YES' : '❌ NO'}`);
      console.log(`      - Primary Model: ${strategy.primaryModel}`);
      console.log(`      - Confidence Threshold: ${strategy.confidenceThreshold}`);
      console.log(`      - Reasoning: ${strategy.reasoning}`);
      
      if (strategy.useVisualAnalysis) {
        console.log(`   🎉 SUCCESS: Field will use Vision API!`);
      } else {
        console.log(`   ❌ PROBLEM: Field will NOT use Vision API!`);
      }
      
    } catch (error) {
      console.log(`   💥 ERROR: ${error.message}`);
    }
    
    console.log();
  }
  
  // Test non-signature field for comparison
  console.log(`📋 Testing Non-Signature Field (for comparison):`);
  try {
    const nonSigStrategy = await adaptiveStrategy.determineStrategy(
      'mechanics_lien',
      'Search throughout this document for any language related to liens, mechanics liens, or legal claims on property or funds.',
      'boolean' as any,
      true
    );
    
    console.log(`   ✅ Non-Signature Strategy:`);
    console.log(`      - Visual Analysis: ${nonSigStrategy.useVisualAnalysis ? '🎯 YES' : '📄 NO'}`);
    console.log(`      - Reasoning: ${nonSigStrategy.reasoning}`);
  } catch (error) {
    console.log(`   💥 ERROR: ${error.message}`);
  }
  
  console.log(`\n🎯 Expected Results:`);
  console.log(`   - Signature fields should have useVisualAnalysis = true`);
  console.log(`   - Non-signature fields may vary based on content`);
  console.log(`   - All fields should process without errors`);
}

// Run if executed directly
if (require.main === module) {
  testSignatureDetection()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

export { testSignatureDetection };