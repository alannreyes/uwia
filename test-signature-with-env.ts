// Load environment variables from .env file
require('dotenv').config();

import { AdaptiveProcessingStrategyService } from './src/modules/underwriting/services/adaptive-processing-strategy.service';
import { openaiConfig } from './src/config/openai.config';

async function testSignatureWithEnv() {
  console.log('🧪 Testing Signature Detection with Environment Variables\n');
  
  // Debug environment variables
  console.log('🔍 Environment Variables:');
  console.log(`   - OPENAI_ENABLED: ${process.env.OPENAI_ENABLED}`);
  console.log(`   - OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'Set (length: ' + process.env.OPENAI_API_KEY.length + ')' : 'Not set'}`);
  console.log(`   - OPENAI_MODEL: ${process.env.OPENAI_MODEL}`);
  console.log(`   - NODE_ENV: ${process.env.NODE_ENV}`);
  console.log();
  
  console.log('🔧 Loaded Config:');
  console.log(`   - openaiConfig.enabled: ${openaiConfig.enabled}`);
  console.log(`   - openaiConfig.apiKey: ${openaiConfig.apiKey ? 'Set (length: ' + openaiConfig.apiKey.length + ')' : 'Not set'}`);
  console.log(`   - openaiConfig.model: ${openaiConfig.model}`);
  console.log(`   - openaiConfig.validationModel: ${openaiConfig.validationModel}`);
  console.log(`   - openaiConfig.dualValidation: ${openaiConfig.dualValidation}`);
  console.log();
  
  const adaptiveStrategy = new AdaptiveProcessingStrategyService();
  
  // Test signature field
  const signatureField = {
    pmcField: 'lop_signed_by_ho1',
    question: 'Determine if a client, customer, homeowner, or property owner has signed this document. Look for any signatures, printed names, or dates in areas designated for the client, homeowner, customer, or property owner. Check signature blocks and signature lines for evidence of client signature. Answer YES if there is evidence of client/homeowner signature, NO if the client section appears blank or unsigned.',
    expectedType: 'boolean'
  };
  
  try {
    console.log(`📋 Testing Field: ${signatureField.pmcField}`);
    console.log(`   Question: ${signatureField.question.substring(0, 100)}...`);
    
    const strategy = await adaptiveStrategy.determineStrategy(
      signatureField.pmcField,
      signatureField.question,
      signatureField.expectedType as any,
      true // documentHasImages = true
    );
    
    console.log(`\n✅ Strategy Result:`);
    console.log(`   - Visual Analysis: ${strategy.useVisualAnalysis ? '🎯 YES' : '❌ NO'}`);
    console.log(`   - Dual Validation: ${strategy.useDualValidation ? '✅ YES' : '❌ NO'}`);
    console.log(`   - Primary Model: ${strategy.primaryModel}`);
    console.log(`   - Confidence Threshold: ${strategy.confidenceThreshold}`);
    console.log(`   - Reasoning: ${strategy.reasoning}`);
    
    if (strategy.useVisualAnalysis) {
      console.log(`\n🎉 SUCCESS: Field will use Vision API!`);
      console.log(`🔧 Expected flow in production:`);
      console.log(`   1. Field detected as needing visual analysis ✅`);
      console.log(`   2. PDF converted to images ✅`);
      console.log(`   3. Vision API called for each page ✅`);
      console.log(`   4. Multi-page analysis logic applied ✅`);
    } else {
      console.log(`\n❌ PROBLEM: Field will NOT use Vision API!`);
    }
    
  } catch (error) {
    console.log(`\n💥 ERROR during strategy determination: ${error.message}`);
    console.log(`Stack: ${error.stack}`);
  }
}

// Run if executed directly
if (require.main === module) {
  testSignatureWithEnv()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

export { testSignatureWithEnv };