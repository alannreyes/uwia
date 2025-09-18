#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const policyPath = path.join(__dirname, '..', 'docs', 'POLICY64.pdf');

console.log('🔍 Checking POLICY64.pdf...');

if (!fs.existsSync(policyPath)) {
    console.error('❌ POLICY64.pdf not found');
    process.exit(1);
}

const buffer = fs.readFileSync(policyPath);
const header = buffer.subarray(0, 100).toString('ascii');

console.log('📄 File size:', (buffer.length / 1024 / 1024).toFixed(2), 'MB');
console.log('📝 First 100 bytes:', header.substring(0, 100));

if (header.startsWith('%PDF-')) {
    console.log('✅ File is a valid PDF');
    process.exit(0);
}

// Check if it's multipart data
if (header.includes('Content-Type: application/pdf')) {
    console.log('⚠️ File appears to be multipart/form-data, not a raw PDF');
    console.log('🔧 Attempting to extract PDF from multipart data...');

    // Find PDF start
    const pdfStartPattern = Buffer.from('%PDF-');
    const pdfStart = buffer.indexOf(pdfStartPattern);

    if (pdfStart === -1) {
        console.error('❌ No PDF data found in file');

        // Try to find the actual PDF content after multipart headers
        const contentStart = buffer.indexOf(Buffer.from('\r\n\r\n'));
        if (contentStart !== -1) {
            const possiblePdfStart = contentStart + 4;
            const extractedData = buffer.subarray(possiblePdfStart);

            // Check if we can find boundary end
            const boundaryEndPattern = Buffer.from('\r\n--');
            const boundaryEnd = extractedData.indexOf(boundaryEndPattern);

            if (boundaryEnd !== -1) {
                const pdfData = extractedData.subarray(0, boundaryEnd);
                console.log('📦 Found possible PDF data between multipart boundaries');
                console.log('📏 Extracted size:', (pdfData.length / 1024 / 1024).toFixed(2), 'MB');

                // Save extracted PDF
                const outputPath = path.join(__dirname, '..', 'docs', 'POLICY64_FIXED.pdf');
                fs.writeFileSync(outputPath, pdfData);
                console.log('💾 Saved extracted data to:', outputPath);
                console.log('⚠️ Please verify if POLICY64_FIXED.pdf is valid');
            }
        }

        process.exit(1);
    }

    // Find PDF end
    const pdfEndPattern = Buffer.from('%%EOF');
    let pdfEnd = buffer.lastIndexOf(pdfEndPattern);

    if (pdfEnd === -1) {
        console.log('⚠️ PDF end marker not found, extracting from start only');
        pdfEnd = buffer.length;
    } else {
        pdfEnd += pdfEndPattern.length;
    }

    const pdfData = buffer.subarray(pdfStart, pdfEnd);

    console.log('📦 Extracted PDF data:');
    console.log('  - Start position:', pdfStart);
    console.log('  - End position:', pdfEnd);
    console.log('  - Size:', (pdfData.length / 1024 / 1024).toFixed(2), 'MB');

    // Save the extracted PDF
    const outputPath = path.join(__dirname, '..', 'docs', 'POLICY64_EXTRACTED.pdf');
    fs.writeFileSync(outputPath, pdfData);

    console.log('✅ Extracted PDF saved to:', outputPath);
    console.log('🔄 You can now replace POLICY64.pdf with POLICY64_EXTRACTED.pdf');

} else {
    console.error('❌ File is not a valid PDF and format is unknown');
    console.log('📋 File appears to be:', header.substring(0, 50));
}