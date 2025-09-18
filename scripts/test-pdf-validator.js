#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Mock PdfValidatorService for testing
class PdfValidatorService {
  validateAndRepairPdf(buffer, filename) {
    console.log(`\n📋 Testing PDF: ${filename || 'unknown'}`);
    console.log(`📊 Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    const result = {
      isValid: false,
      wasRepaired: false,
      buffer: buffer,
      error: null,
      details: null
    };

    try {
      // Check if buffer is empty
      if (!buffer || buffer.length === 0) {
        result.error = 'Empty buffer provided';
        return result;
      }

      // Check PDF header
      const header = buffer.subarray(0, Math.min(100, buffer.length)).toString('ascii');

      // Case 1: Valid PDF
      if (header.startsWith('%PDF-')) {
        console.log(`✅ Valid PDF detected`);
        result.isValid = true;
        return result;
      }

      // Case 2: Multipart form data wrapping
      if (header.includes('Content-Type: application/pdf') || header.includes('Content-Type: multipart')) {
        console.log(`⚠️ Multipart/form-data detected, attempting repair...`);

        const repaired = this.extractPdfFromMultipart(buffer);
        if (repaired) {
          console.log(`✅ Successfully extracted PDF from multipart data`);
          console.log(`📊 Original size: ${(buffer.length / 1024 / 1024).toFixed(2)}MB -> Repaired: ${(repaired.length / 1024 / 1024).toFixed(2)}MB`);
          result.isValid = true;
          result.wasRepaired = true;
          result.buffer = repaired;
          result.details = 'Extracted PDF from multipart/form-data wrapper';
          return result;
        }
      }

      // Case 3: Base64 encoded PDF
      if (this.isBase64(header)) {
        console.log(`⚠️ Base64 encoded data detected, attempting decode...`);
        try {
          const decoded = Buffer.from(buffer.toString('ascii'), 'base64');
          const decodedHeader = decoded.subarray(0, 5).toString('ascii');

          if (decodedHeader.startsWith('%PDF-')) {
            console.log(`✅ Successfully decoded Base64 PDF`);
            result.isValid = true;
            result.wasRepaired = true;
            result.buffer = decoded;
            result.details = 'Decoded from Base64';
            return result;
          }
        } catch (e) {
          console.log(`⚠️ Base64 decode failed: ${e.message}`);
        }
      }

      // Case 4: PDF with extra bytes at beginning
      const pdfStart = buffer.indexOf(Buffer.from('%PDF-'));
      if (pdfStart > 0 && pdfStart < 1024) {
        console.log(`⚠️ PDF header found at offset ${pdfStart}, trimming extra bytes...`);
        const trimmed = buffer.subarray(pdfStart);
        result.isValid = true;
        result.wasRepaired = true;
        result.buffer = trimmed;
        result.details = `Removed ${pdfStart} bytes from beginning`;
        return result;
      }

      // Case 5: Completely corrupted
      console.log(`❌ Unable to validate or repair PDF`);
      result.error = `Invalid PDF format - header: ${header.substring(0, 20)}`;
      return result;

    } catch (error) {
      console.log(`❌ Unexpected error: ${error.message}`);
      result.error = error.message;
      return result;
    }
  }

  extractPdfFromMultipart(buffer) {
    try {
      const pdfStartPattern = Buffer.from('%PDF-');
      const pdfStart = buffer.indexOf(pdfStartPattern);

      if (pdfStart === -1) {
        const contentStart = buffer.indexOf(Buffer.from('\r\n\r\n'));
        if (contentStart !== -1) {
          const possiblePdfStart = contentStart + 4;
          const extractedData = buffer.subarray(possiblePdfStart);
          const boundaryEndPattern = Buffer.from('\r\n--');
          const boundaryEnd = extractedData.indexOf(boundaryEndPattern);

          if (boundaryEnd !== -1) {
            const pdfData = extractedData.subarray(0, boundaryEnd);
            const header = pdfData.subarray(0, 5).toString('ascii');
            if (header.startsWith('%PDF-')) {
              return pdfData;
            }
          }
        }
        return null;
      }

      const pdfEndPattern = Buffer.from('%%EOF');
      let pdfEnd = buffer.lastIndexOf(pdfEndPattern);

      if (pdfEnd === -1) {
        const fromPdfStart = buffer.subarray(pdfStart);
        const boundaryPattern = Buffer.from('\r\n--');
        const boundaryPos = fromPdfStart.indexOf(boundaryPattern);
        pdfEnd = boundaryPos !== -1 ? pdfStart + boundaryPos : buffer.length;
      } else {
        pdfEnd += pdfEndPattern.length;
      }

      const pdfData = buffer.subarray(pdfStart, pdfEnd);
      return pdfData.length > 100 ? pdfData : null;
    } catch (error) {
      console.log(`❌ Multipart extraction failed: ${error.message}`);
      return null;
    }
  }

  isBase64(str) {
    const cleaned = str.replace(/\s/g, '');
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    return cleaned.length > 20 && base64Regex.test(cleaned.substring(0, 100));
  }
}

// Test cases
console.log('🧪 PDF Validator Test Suite\n');
console.log('=' .repeat(50));

const validator = new PdfValidatorService();
const testDir = path.join(__dirname, '..', 'docs');

// Test Case 1: Valid PDF
const validPdfPath = path.join(testDir, 'POLICY11.pdf');
if (fs.existsSync(validPdfPath)) {
  const buffer = fs.readFileSync(validPdfPath);
  const result = validator.validateAndRepairPdf(buffer, 'POLICY11.pdf');
  console.log(`Result: ${result.isValid ? '✅ VALID' : '❌ INVALID'}`);
  console.log(`Repaired: ${result.wasRepaired ? 'Yes' : 'No'}`);
  if (result.error) console.log(`Error: ${result.error}`);
  if (result.details) console.log(`Details: ${result.details}`);
}

console.log('\n' + '=' .repeat(50));

// Test Case 2: Create corrupted multipart PDF
const corruptedMultipart = Buffer.concat([
  Buffer.from('--boundary123\r\n'),
  Buffer.from('Content-Type: application/pdf\r\n'),
  Buffer.from('Content-Disposition: form-data; name="file"\r\n\r\n'),
  Buffer.from('%PDF-1.4\n1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n%%EOF'),
  Buffer.from('\r\n--boundary123--')
]);

const result2 = validator.validateAndRepairPdf(corruptedMultipart, 'CORRUPTED_MULTIPART.pdf');
console.log(`Result: ${result2.isValid ? '✅ VALID' : '❌ INVALID'}`);
console.log(`Repaired: ${result2.wasRepaired ? 'Yes' : 'No'}`);
if (result2.error) console.log(`Error: ${result2.error}`);
if (result2.details) console.log(`Details: ${result2.details}`);

console.log('\n' + '=' .repeat(50));

// Test Case 3: PDF with extra bytes at beginning
const extraBytes = Buffer.concat([
  Buffer.from('JUNK_DATA_HERE'),
  Buffer.from('%PDF-1.4\n1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n%%EOF')
]);

const result3 = validator.validateAndRepairPdf(extraBytes, 'EXTRA_BYTES.pdf');
console.log(`Result: ${result3.isValid ? '✅ VALID' : '❌ INVALID'}`);
console.log(`Repaired: ${result3.wasRepaired ? 'Yes' : 'No'}`);
if (result3.error) console.log(`Error: ${result3.error}`);
if (result3.details) console.log(`Details: ${result3.details}`);

console.log('\n' + '=' .repeat(50));
console.log('\n✅ All tests completed!\n');