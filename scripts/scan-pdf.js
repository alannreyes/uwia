#!/usr/bin/env node
// Simple PDF keyword scanner for quick evidence checks
// Usage: node scripts/scan-pdf.js <file> <pattern1>|<pattern2>|...

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

function extractSnippets(text, regex, maxSnippets = 3, window = 80) {
  const snippets = [];
  let match;
  const re = new RegExp(regex, 'gi');
  while ((match = re.exec(text)) !== null && snippets.length < maxSnippets) {
    const start = Math.max(0, match.index - window);
    const end = Math.min(text.length, match.index + (match[0]?.length || 0) + window);
    let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
    snippets.push(snippet);
  }
  return snippets;
}

async function main() {
  const [,, file, patterns] = process.argv;
  if (!file || !patterns) {
    console.error('Usage: node scripts/scan-pdf.js <file> <pattern1>|<pattern2>|...');
    process.exit(1);
  }
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }
  const data = fs.readFileSync(filePath);
  const pdf = await pdfParse(data);
  const text = (pdf.text || '').toLowerCase();
  const pats = patterns.split('|').filter(Boolean).map(p => p.trim()).filter(p => p.length > 0);

  const results = [];
  for (const pat of pats) {
    const re = new RegExp(pat, 'gi');
    let count = 0; let m;
    while ((m = re.exec(text)) !== null) count++;
    const snippets = count > 0 ? extractSnippets(text, pat, 2, 120) : [];
    results.push({ pattern: pat, count, snippets });
  }

  console.log(JSON.stringify({ file: path.basename(filePath), pages: pdf.numpages, words: text.split(/\s+/).length, results }, null, 2));
}

main().catch(err => { console.error('scan error:', err.message); process.exit(2); });

