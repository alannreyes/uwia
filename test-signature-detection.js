const fs = require('fs');
const path = require('path');

// Utilidades para PDF
const pdfParse = require('pdf-parse');
const { pdfToPng } = require('pdf-to-png-converter');

class SignatureDetectionTester {
  constructor() {
    this.results = [];
    this.testsPassed = 0;
    this.testsFailed = 0;
  }

  log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${message}`);
  }

  async convertPdfToImages(pdfPath, highRes = true) {
    try {
      const pdfBuffer = fs.readFileSync(pdfPath);
      
      const options = {
        viewportScale: highRes ? 4.0 : 2.0,
        outputFileMask: 'buffer',
        verbosityLevel: 0,
        disableFontFace: false,
        useSystemFonts: highRes,
        pngOptions: highRes ? {
          compressionLevel: 0,
          palette: false,
          quality: 100
        } : {
          compressionLevel: 6,
          quality: 85
        }
      };

      const pngPages = await pdfToPng(pdfBuffer, options);
      
      return pngPages.map(page => ({
        pageNumber: page.pageNumber,
        base64: page.content.toString('base64'),
        sizeMB: (page.content.length / 1048576).toFixed(2)
      }));
    } catch (error) {
      this.log(`Error converting PDF: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  async analyzeImageLocally(imageBase64, pageNumber, testName) {
    try {
      this.log(`Local analysis: ${testName} (Page ${pageNumber})`);
      
      // Guardar imagen para análisis manual
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const imagePath = path.join(__dirname, `test-images`, `page${pageNumber}-${testName}.png`);
      
      // Crear directorio si no existe
      const dir = path.dirname(imagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(imagePath, imageBuffer);
      
      const result = {
        testName,
        pageNumber,
        imagePath,
        imageSize: `${(imageBuffer.length / 1048576).toFixed(2)}MB`,
        base64Length: imageBase64.length,
        analysis: 'Saved for manual inspection'
      };

      this.results.push(result);
      this.log(`✅ Image saved: ${imagePath}`);
      return result;
    } catch (error) {
      this.log(`Error saving image ${testName}: ${error.message}`, 'ERROR');
      return {
        testName,
        pageNumber,
        error: error.message
      };
    }
  }

  // HIPÓTESIS 1: Problema con etiquetas específicas
  async testHypothesis1_LabelMismatch(images) {
    this.log('=== TESTING HYPOTHESIS 1: FIELD LABEL MISMATCH ===');
    
    const scenarios = [
      { name: 'generic_signature', description: 'General signature detection' },
      { name: 'client_signature', description: 'Client-specific signature detection' },
      { name: 'homeowner_signature', description: 'Homeowner-specific signature detection' },
      { name: 'priscilla_signature', description: 'Priscilla Chavez signature detection' },
      { name: 'felipe_signature', description: 'Felipe R Moreno signature detection' }
    ];

    for (const image of images) {
      this.log(`Analyzing page ${image.pageNumber} (${image.sizeMB}MB) for label mismatch scenarios`);
      
      for (const scenario of scenarios) {
        await this.analyzeImageLocally(image.base64, image.pageNumber, 
          `H1_${scenario.name}`);
      }
    }
  }

  // HIPÓTESIS 2: Problema con orden de páginas o ubicación
  async testHypothesis2_PageOrder(images) {
    this.log('=== TESTING HYPOTHESIS 2: PAGE LOCATION AND ORDER ===');
    
    // Test específico para página 2 donde vimos las firmas
    const page2 = images.find(img => img.pageNumber === 2);
    if (!page2) {
      this.log('Page 2 not found!', 'ERROR');
      return;
    }

    const scenarios = [
      { name: 'page2_focused', description: 'Page 2 focused analysis' },
      { name: 'page2_signature_area', description: 'Page 2 signature area analysis' },
      { name: 'page2_full_scan', description: 'Page 2 full page scan' }
    ];

    for (const scenario of scenarios) {
      await this.analyzeImageLocally(page2.base64, page2.pageNumber, 
        `H2_${scenario.name}`);
    }

    // Analizar orden de páginas
    this.log('Testing page processing order...');
    for (const image of images) {
      await this.analyzeImageLocally(image.base64, image.pageNumber, 
        `H2_page_order_${image.pageNumber}`);
    }
  }

  // HIPÓTESIS 3: Problema con formato de firma (digitalizada vs manuscrita)
  async testHypothesis3_SignatureFormat(images) {
    this.log('=== TESTING HYPOTHESIS 3: SIGNATURE FORMAT RECOGNITION ===');
    
    const page2 = images.find(img => img.pageNumber === 2);
    if (!page2) return;

    const scenarios = [
      { name: 'handwritten_focus', description: 'Focus on handwritten signatures' },
      { name: 'digitized_focus', description: 'Focus on digitized/electronic signatures' },
      { name: 'signature_lines_focus', description: 'Focus on signature lines and areas' },
      { name: 'format_analysis', description: 'General signature format analysis' }
    ];

    for (const scenario of scenarios) {
      await this.analyzeImageLocally(page2.base64, page2.pageNumber, 
        `H3_${scenario.name}`);
    }
    
    // También analizar la página 1 para comparar
    const page1 = images.find(img => img.pageNumber === 1);
    if (page1) {
      await this.analyzeImageLocally(page1.base64, page1.pageNumber, 
        'H3_page1_comparison');
    }
  }

  printResults() {
    this.log('=== FINAL TEST RESULTS ===');
    
    console.log('\n' + '='.repeat(80));
    console.log('SIGNATURE DETECTION LOCAL ANALYSIS RESULTS');
    console.log('='.repeat(80));
    
    // Agrupar por hipótesis
    const h1Results = this.results.filter(r => r.testName.startsWith('H1_'));
    const h2Results = this.results.filter(r => r.testName.startsWith('H2_'));
    const h3Results = this.results.filter(r => r.testName.startsWith('H3_'));

    console.log('\n📋 HYPOTHESIS 1: FIELD LABEL MISMATCH');
    console.log('-'.repeat(50));
    h1Results.forEach(r => {
      console.log(`${r.testName.padEnd(30)} | Page ${r.pageNumber} | ${r.imageSize || 'N/A'}`);
      console.log(`   → ${r.imagePath || 'No path'}`);
    });

    console.log('\n📍 HYPOTHESIS 2: PAGE LOCATION AND ORDER');
    console.log('-'.repeat(50));  
    h2Results.forEach(r => {
      console.log(`${r.testName.padEnd(30)} | Page ${r.pageNumber} | ${r.imageSize || 'N/A'}`);
      console.log(`   → ${r.imagePath || 'No path'}`);
    });

    console.log('\n✍️ HYPOTHESIS 3: SIGNATURE FORMAT RECOGNITION');
    console.log('-'.repeat(50));
    h3Results.forEach(r => {
      console.log(`${r.testName.padEnd(30)} | Page ${r.pageNumber} | ${r.imageSize || 'N/A'}`);
      console.log(`   → ${r.imagePath || 'No path'}`);
    });
    
    console.log('\n📊 SUMMARY ANALYSIS');
    console.log('-'.repeat(50));
    console.log(`Total images generated: ${this.results.length}`);
    console.log(`H1 (Label Mismatch): ${h1Results.length} images`);
    console.log(`H2 (Page Order): ${h2Results.length} images`);
    console.log(`H3 (Format Recognition): ${h3Results.length} images`);
    
    const totalSizeMB = this.results.reduce((sum, r) => {
      const size = parseFloat(r.imageSize?.replace('MB', '') || '0');
      return sum + size;
    }, 0);
    
    console.log(`Total size: ${totalSizeMB.toFixed(2)}MB`);
    console.log('\n🔍 NEXT STEPS:');
    console.log('1. Manually inspect the generated images in test-images/ folder');
    console.log('2. Compare what you see vs what the AI models reported');
    console.log('3. Identify patterns in signature visibility and format');
    console.log('4. Use findings to update prompts or processing logic');
  }

  async runAllTests() {
    try {
      this.log('Starting comprehensive signature detection tests...');
      
      const pdfPath = path.join(__dirname, 'docs', 'LOP.pdf');
      if (!fs.existsSync(pdfPath)) {
        throw new Error(`LOP.pdf not found at ${pdfPath}`);
      }

      this.log('Converting PDF to high-resolution images...');
      const images = await this.convertPdfToImages(pdfPath, true);
      this.log(`Generated ${images.length} pages, sizes: ${images.map(i => i.sizeMB + 'MB').join(', ')}`);

      // Ejecutar todas las hipótesis
      await this.testHypothesis1_LabelMismatch(images);
      await this.testHypothesis2_PageOrder(images);
      await this.testHypothesis3_SignatureFormat(images);

      this.printResults();
      
      // Guardar resultados en JSON para análisis posterior
      const resultsFile = path.join(__dirname, 'signature-test-results.json');
      fs.writeFileSync(resultsFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        results: this.results,
        summary: {
          totalTests: this.results.length,
          yesResponses: this.results.filter(r => r.response && r.response.toUpperCase().includes('YES')).length,
          noResponses: this.results.filter(r => r.response && r.response.toUpperCase().includes('NO')).length
        }
      }, null, 2));
      
      this.log(`Results saved to ${resultsFile}`);
      
    } catch (error) {
      this.log(`Test execution failed: ${error.message}`, 'ERROR');
      throw error;
    }
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  const tester = new SignatureDetectionTester();
  tester.runAllTests().catch(console.error);
}

module.exports = SignatureDetectionTester;