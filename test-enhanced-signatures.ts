import { OpenAiService } from './src/modules/underwriting/services/openai.service';
import { JudgeValidatorService } from './src/modules/underwriting/services/judge-validator.service';
import { PdfImageService } from './src/modules/underwriting/services/pdf-image.service';
import { ResponseType } from './src/modules/underwriting/entities/uw-evaluation.entity';
import * as fs from 'fs';

async function testEnhancedSignatures() {
  console.log('🧪 Testing Enhanced Signature Detection\n');
  
  // Load the LOP.pdf from docs folder
  const pdfPath = './docs/LOP.pdf';
  if (!fs.existsSync(pdfPath)) {
    console.error('❌ LOP.pdf not found in docs folder');
    return;
  }

  const pdfBuffer = fs.readFileSync(pdfPath);
  const pdfBase64 = pdfBuffer.toString('base64');
  
  console.log(`📄 Loaded LOP.pdf: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB`);

  // Initialize services
  const judgeValidator = new JudgeValidatorService();
  const openaiService = new OpenAiService(judgeValidator);
  const pdfImageService = new PdfImageService();

  try {
    // Convert PDF to high-resolution images (LOP-specific 4x resolution)
    console.log('🖼️ Converting PDF to high-resolution images...');
    const images = await pdfImageService.convertSignaturePages(pdfBase64, 'LOP.pdf');
    
    console.log(`✅ Converted ${images.size} pages`);
    images.forEach((_, pageNum) => {
      console.log(`   Page ${pageNum}: Ready for analysis`);
    });

    // Test enhanced prompts
    const testCases = [
      {
        field: 'lop_signed_by_client1',
        prompt: `Look carefully for ANY handwritten signature, mark, or initial in the "Client 1 Signature", "Client Signature", or any field labeled for CLIENT/CUSTOMER signatures. 

WHAT TO LOOK FOR:
- Handwritten cursive signatures (like "Priscilla Chavez")
- Printed names written by hand  
- Initials or abbreviated signatures
- X marks or simple signature marks
- Any pen/pencil marks in signature fields

VISUAL CLUES:
- Look for signature lines (horizontal lines for signing)
- Areas with labels containing "Client", "Customer", "Insured", "Signature"
- Handwritten text that differs from printed text
- Dark ink marks that appear to be made by hand

Answer YES if you see ANY handwritten mark in client signature areas, even if it's unclear or partially visible. Answer NO only if signature areas appear completely blank.`
      },
      {
        field: 'lop_signed_by_ho1', 
        prompt: `Look carefully for ANY handwritten signature, mark, or initial in the "Service Provider Representative", "Provider Signature", "Contractor Signature", or any field labeled for PROVIDER/CONTRACTOR signatures.

WHAT TO LOOK FOR:
- Handwritten cursive signatures (like "Felipe R Moreno")
- Printed names written by hand
- Initials or abbreviated signatures  
- X marks or simple signature marks
- Any pen/pencil marks in signature fields

VISUAL CLUES:
- Look for signature lines (horizontal lines for signing)
- Areas with labels containing "Provider", "Contractor", "Representative", "Company", "Signature"
- Handwritten text that differs from printed text
- Dark ink marks that appear to be made by hand

Answer YES if you see ANY handwritten mark in provider/contractor signature areas, even if it's unclear or partially visible. Answer NO only if signature areas appear completely blank.`
      }
    ];

    // Test each field with enhanced prompts
    for (const testCase of testCases) {
      console.log(`\n📋 Testing: ${testCase.field}`);
      console.log(`🔍 Enhanced prompt applied`);
      
      // Test with both pages
      for (const [pageNum, imageBase64] of images) {
        try {
          console.log(`\n   Testing Page ${pageNum}:`);
          
          const result = await openaiService.evaluateWithVision(
            imageBase64,
            testCase.prompt,
            ResponseType.BOOLEAN,
            testCase.field,
            pageNum
          );

          console.log(`   🎯 GPT-4o Result: ${result.response} (confidence: ${result.confidence})`);
          
          if (result.response === 'YES') {
            console.log(`   ✅ SIGNATURE DETECTED on page ${pageNum}!`);
          } else {
            console.log(`   ❌ No signature detected on page ${pageNum}`);
          }
          
        } catch (error) {
          console.log(`   ⚠️ Error on page ${pageNum}: ${error.message}`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run if executed directly
if (require.main === module) {
  testEnhancedSignatures()
    .then(() => {
      console.log('\n🎉 Enhanced signature test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

export { testEnhancedSignatures };