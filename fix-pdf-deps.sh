#!/bin/bash

echo "🔧 Fixing PDF library dependencies..."

# Remove old packages
echo "📦 Removing old PDF packages..."
npm uninstall pdfjs-dist pdf-parse pdf-lib canvas

# Clean npm cache
echo "🧹 Cleaning npm cache..."
npm cache clean --force

# Install canvas dependencies (for Docker/Linux)
echo "📦 Installing system dependencies for canvas..."
if [ -f /etc/alpine-release ]; then
    # Alpine Linux (common in Docker)
    apk add --no-cache \
        build-base \
        cairo-dev \
        pango-dev \
        jpeg-dev \
        giflib-dev \
        librsvg-dev \
        pixman-dev
else
    # Debian/Ubuntu
    apt-get update && apt-get install -y \
        build-essential \
        libcairo2-dev \
        libpango1.0-dev \
        libjpeg-dev \
        libgif-dev \
        librsvg2-dev
fi

# Install unified versions
echo "📦 Installing unified PDF libraries..."
npm install \
    pdfjs-dist@3.11.174 \
    pdf-parse@1.1.1 \
    pdf-lib@1.17.1 \
    canvas@2.11.2

# Optional: Install OCR libraries for future enhancement
echo "📦 Installing optional OCR libraries..."
npm install --save-optional \
    tesseract.js@5.0.4 \
    node-signpdf@3.2.0

echo "✅ PDF dependencies fixed!"
echo ""
echo "📋 Installed versions:"
npm list pdfjs-dist pdf-parse pdf-lib canvas tesseract.js node-signpdf 2>/dev/null | grep -E "^[├└]"

echo ""
echo "🚀 Next steps:"
echo "1. Update PdfParserService to use PdfToolkitService"
echo "2. Update PdfImageService to use PdfToolkitService"
echo "3. Test with problematic PDFs"