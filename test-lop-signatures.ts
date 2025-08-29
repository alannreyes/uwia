#!/usr/bin/env ts-node

import { OpenAI } from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { pdfToPng } from 'pdf-to-png-converter';

// Configuración de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // Se requiere OPENAI_API_KEY en variables de entorno
});

console.log('🔍 Testing LOP.pdf Signature Detection\n');
console.log('=' . repeat(80));

async function testSignatureDetection() {
  try {
    // Leer el archivo LOP.pdf
    const pdfPath = path.join(__dirname, 'docs', 'LOP .pdf');
    console.log(`📄 Reading PDF from: ${pdfPath}`);
    
    const pdfBuffer = fs.readFileSync(pdfPath);
    console.log(`✅ PDF loaded: ${(pdfBuffer.length / 1024).toFixed(2)} KB\n`);

    // Convertir PDF a imágenes
    console.log('🖼️ Converting PDF to images...');
    const options = {
      viewportScale: 2.0,
      verbosityLevel: 0
    };
    
    const pngPages = await pdfToPng(pdfBuffer, options);
    console.log(`✅ Converted ${pngPages.length} pages\n`);

    // Definir los campos de firma a buscar
    const signatureFields = [
      {
        pmcField: 'lop_signed_by_ho1',
        question: 'Determine if a client, customer, homeowner, or property owner has signed this document. Look for any signatures, printed names, or dates in areas designated for the client, homeowner, customer, or property owner. Check signature blocks and signature lines for evidence of client signature. Answer YES if there is evidence of client/homeowner signature, NO if the client section appears blank or unsigned.'
      },
      {
        pmcField: 'lop_signed_by_client1',
        question: 'Determine if a service provider, contractor, or company representative has signed this document. Look for any signatures, printed names, or dates in areas designated for the service provider, contractor, company, or vendor. Check signature blocks, signature lines, or any area where a business representative would sign. Answer YES if there is evidence of provider/contractor signature, NO if the provider section appears blank or unsigned.'
      }
    ];

    // Analizar cada página para cada campo
    for (const field of signatureFields) {
      console.log('=' . repeat(80));
      console.log(`\n🎯 Testing: ${field.pmcField}`);
      console.log('=' . repeat(80));
      
      let foundSignature = false;
      let bestResult = { page: 0, answer: 'NO', confidence: 0 };
      
      for (const page of pngPages) {
        const pageNum = page.pageNumber;
        const base64Image = page.content.toString('base64');
        
        console.log(`\n📄 Analyzing page ${pageNum}...`);
        
        // Crear el prompt optimizado para detección de firmas
        const visionPrompt = `You are an expert document analyst examining this image for signatures and signing evidence.

TASK: ${field.question}

WHAT TO LOOK FOR:
✓ Handwritten signatures or initials (cursive, print, or stylized)
✓ Signature lines with names written above or below them
✓ "X" marks or other signing indicators  
✓ Printed names near signature areas (often indicates signing intent)
✓ Date stamps near signature areas
✓ Any form of authorization marks or signing evidence

SIGNATURE DETECTION GUIDELINES:
- Answer "YES" if you see ANY form of signature, handwritten name, or signing evidence
- Answer "YES" if you see printed names on signature lines (common in digital forms)
- Answer "YES" if you see dates associated with signature areas (indicates signing activity)
- Only answer "NO" if signature areas are completely blank with no marks whatsoever

Answer with ONLY "YES" or "NO".

Be thorough but decisive - signatures can appear in various forms and locations throughout the document.`;

        try {
          const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: visionPrompt },
                  { 
                    type: 'image_url', 
                    image_url: { 
                      url: `data:image/png;base64,${base64Image}`,
                      detail: 'high'
                    } 
                  }
                ]
              }
            ],
            // temperature: 1, // GPT-5: Only default value (1) supported - removed parameter
            max_completion_tokens: 10
          });

          const answer = response.choices[0].message.content?.trim().toUpperCase() || 'NO';
          const confidence = answer === 'YES' ? 0.85 : 0.5;
          
          console.log(`   Result: ${answer} (confidence: ${confidence})`);
          
          if (answer === 'YES') {
            foundSignature = true;
            if (confidence > bestResult.confidence) {
              bestResult = { page: pageNum, answer, confidence };
            }
          } else if (!foundSignature && confidence > bestResult.confidence) {
            bestResult = { page: pageNum, answer, confidence };
          }
          
        } catch (error) {
          console.error(`   ❌ Error analyzing page ${pageNum}:`, error.message);
        }
        
        // Pequeña pausa entre páginas para evitar rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log('\n' + '=' . repeat(80));
      console.log(`📊 FINAL RESULT for ${field.pmcField}:`);
      console.log(`   Answer: ${bestResult.answer}`);
      console.log(`   Confidence: ${bestResult.confidence}`);
      console.log(`   Best page: ${bestResult.page}`);
      console.log(`   Expected: YES (según validación manual)`);
      console.log(`   Status: ${bestResult.answer === 'YES' ? '✅ CORRECT' : '❌ INCORRECT'}`);
      console.log('=' . repeat(80));
    }

    // Información adicional
    console.log('\n📋 INFORMACIÓN DEL DOCUMENTO:');
    console.log('   - El LOP.pdf tiene firmas en la página 2');
    console.log('   - JOSE ESQUIVEL y JOSEFINA ESQUIVEL firmaron como clientes');
    console.log('   - OSMAN DELGADO firmó como proveedor de servicio');
    console.log('   - Todas las firmas tienen fecha 6/7/2025');
    
  } catch (error) {
    console.error('❌ Error in test:', error);
  }
}

// Ejecutar el test
testSignatureDetection().then(() => {
  console.log('\n✅ Test completed');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});