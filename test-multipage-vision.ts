import { UnderwritingService } from './src/modules/underwriting/underwriting.service';
import { OpenAiService } from './src/modules/underwriting/services/openai.service';
import { PdfImageService } from './src/modules/underwriting/services/pdf-image.service';
import { AdaptiveProcessingStrategyService } from './src/modules/underwriting/services/adaptive-processing-strategy.service';
import { JudgeValidatorService } from './src/modules/underwriting/services/judge-validator.service';
import * as fs from 'fs';
import * as path from 'path';

async function testMultiPageVision() {
  console.log('🧪 Testing Multi-Page Vision Analysis\n');
  
  try {
    // Initialize services
    const judgeValidator = new JudgeValidatorService();
    const openAiService = new OpenAiService(judgeValidator);
    const pdfImageService = new PdfImageService();
    
    // Test with LOP .pdf if available
    const lopPath = path.join(__dirname, 'docs', 'LOP .pdf');
    if (!fs.existsSync(lopPath)) {
      console.log('❌ LOP.pdf not found at docs/LOP.pdf');
      return;
    }
    
    // Read and convert PDF to base64
    const pdfBuffer = fs.readFileSync(lopPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    console.log(`📄 Loaded LOP.pdf (${(pdfBuffer.length / 1024).toFixed(1)}KB)`);
    
    // Convert ALL pages to images
    console.log('🔄 Converting PDF pages to images...');
    const images = await pdfImageService.convertSignaturePages(pdfBase64);
    console.log(`📸 Converted ${images.size} pages: ${Array.from(images.keys()).join(', ')}`);
    
    // Test signature detection on each page
    const signatureField = 'lop_signed_by_ho1';
    const signatureQuestion = 'Is the Letter of Protection signed by the homeowner?';
    
    console.log(`\n🔍 Testing signature detection: ${signatureField}`);
    console.log(`Question: ${signatureQuestion}\n`);
    
    // Analyze each page individually (simulating the new multi-page logic)
    const pageNumbers = Array.from(images.keys()).sort((a, b) => a - b);
    let bestResponse: any = null;
    let bestConfidence = 0;
    let foundPositiveAnswer = false;
    
    for (const pageNumber of pageNumbers) {
      const pageImage = images.get(pageNumber);
      
      if (pageImage) {
        console.log(`🎯 Analyzing page ${pageNumber}...`);
        
        try {
          const pageResponse = await openAiService.evaluateWithVision(
            pageImage,
            signatureQuestion,
            'boolean' as any,
            signatureField,
            pageNumber
          );
          
          console.log(`   Result: ${pageResponse.response} (confidence: ${(pageResponse.confidence * 100).toFixed(1)}%)`);
          
          // Para campos de firma, si encontramos un "YES" con buena confianza, usarlo inmediatamente
          if (pageResponse.response === 'YES' && pageResponse.confidence >= 0.7) {
            console.log(`   ✅ Found positive signature on page ${pageNumber} - using this result`);
            bestResponse = pageResponse;
            foundPositiveAnswer = true;
            break;
          }
          
          // Mantener la respuesta con mayor confianza
          if (pageResponse.confidence > bestConfidence) {
            bestResponse = pageResponse;
            bestConfidence = pageResponse.confidence;
          }
          
        } catch (pageError) {
          console.log(`   ⚠️ Error analyzing page ${pageNumber}: ${pageError.message}`);
          continue;
        }
      }
    }
    
    // Resultado final
    console.log('\n📊 FINAL RESULT:');
    if (foundPositiveAnswer) {
      console.log(`✅ POSITIVE signature found with high confidence`);
    } else if (bestResponse) {
      console.log(`📊 Best result: ${bestResponse.response} (${(bestResponse.confidence * 100).toFixed(1)}% confidence)`);
    } else {
      console.log(`❌ No pages could be analyzed successfully`);
    }
    
    console.log(`\n🎉 Multi-page analysis completed!`);
    console.log(`   Pages analyzed: ${pageNumbers.length}`);
    console.log(`   Method: Sequential analysis with early positive detection`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Run if executed directly
if (require.main === module) {
  testMultiPageVision()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

export { testMultiPageVision };