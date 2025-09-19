# UWIA System Documentation Index

## 📚 Main Documentation

### 🏠 **Getting Started**
- **[README.md](./README.md)** - Main project overview, features, and quick start
- **[CURRENT_SYSTEM_GUIDE.md](./CURRENT_SYSTEM_GUIDE.md)** - Current system architecture and components

### ⚙️ **Configuration**
- **[DOCUMENT_PROMPTS_TABLE.md](./DOCUMENT_PROMPTS_TABLE.md)** - Document configuration and recent optimizations
- **[database/CONFIGURATION.md](./database/CONFIGURATION.md)** - Database setup and configuration
- **[LOG_LEVEL_SETUP.md](./LOG_LEVEL_SETUP.md)** - Logging configuration guide

### 🚀 **Performance & Optimization**
- **[OPTIMIZED_FILE_PROCESSING_GUIDE.md](./OPTIMIZED_FILE_PROCESSING_GUIDE.md)** ⭐ **NEW** - File processing optimization guide
- **[FILE_SIZE_OPTIMIZATION_RECOMMENDATIONS.md](./FILE_SIZE_OPTIMIZATION_RECOMMENDATIONS.md)** - Technical recommendations
- **[BYPASS_SPLITTING_SUCCESS.md](./BYPASS_SPLITTING_SUCCESS.md)** - Bypass implementation results

### 🔧 **Technical Implementation**
- **[GEMINI_FILE_API_IMPLEMENTATION.md](./GEMINI_FILE_API_IMPLEMENTATION.md)** - Gemini File API integration
- **[GEMINI_USAGE_GUIDE.md](./GEMINI_USAGE_GUIDE.md)** - Gemini usage patterns
- **[MEJORAS_IMPLEMENTADAS.md](./MEJORAS_IMPLEMENTADAS.md)** - Implemented improvements

### 🧪 **Testing & Debugging**
- **[TESTING_RESULTS.md](./TESTING_RESULTS.md)** - Current testing results and status
- **[DEBUG_VARIABLES.md](./DEBUG_VARIABLES.md)** - Debug variables documentation
- **[POLICY_PDF_ANALYSIS.md](./POLICY_PDF_ANALYSIS.md)** - POLICY.pdf specific analysis

### 📝 **Prompts & Processing**
- **[promptsv2.md](./promptsv2.md)** - Prompt engineering guidelines
- **[docs/single-document-processing.md](./docs/single-document-processing.md)** - Single document processing

## 📊 **Recent Updates (September 2025)**

### ✨ **Major Optimizations**
1. **File Processing Optimization** (Sept 19, 2025)
   - New optimized thresholds: 10MB/150MB
   - Direct File API for medium files (10-150MB)
   - POLICY.pdf now processes in 30.4s ✅

2. **ROOF.pdf Fix** (Sept 18, 2025)
   - Simplified prompt for better extraction
   - Now extracts "2250" instead of NOT_FOUND

3. **POLICY.pdf Variables** (Sept 18, 2025)
   - Enhanced variable handling for empty comparisons
   - Smart extraction when comparison data is missing

## 🗂️ **File Organization**

### Active Documentation
- **Primary**: README.md, OPTIMIZED_FILE_PROCESSING_GUIDE.md
- **Configuration**: DOCUMENT_PROMPTS_TABLE.md, database/CONFIGURATION.md
- **Implementation**: GEMINI_*.md files
- **Testing**: TESTING_RESULTS.md, DEBUG_VARIABLES.md

### Deprecated/Removed ❌
- ~~continuar.md~~ - Obsolete continuation plan
- ~~planconsolidado.md~~ - Obsolete consolidated plan
- ~~optimizacion.md~~ - Replaced by OPTIMIZED_FILE_PROCESSING_GUIDE.md
- ~~mejoras.md~~ - Replaced by MEJORAS_IMPLEMENTADAS.md
- ~~plandeajuste.md~~ - Obsolete adjustment plan

## 🔍 **Quick Reference**

| Need | Document |
|------|----------|
| Setup system | README.md |
| Configure documents | DOCUMENT_PROMPTS_TABLE.md |
| Optimize performance | OPTIMIZED_FILE_PROCESSING_GUIDE.md |
| Debug issues | DEBUG_VARIABLES.md, TESTING_RESULTS.md |
| Understand implementation | GEMINI_FILE_API_IMPLEMENTATION.md |
| Database setup | database/CONFIGURATION.md |

## 📈 **Performance Metrics**

| Document Type | Size | Processing Time | Method |
|---------------|------|----------------|---------|
| POLICY.pdf | 31.43MB | 30.4s | File API Direct ✅ |
| CERTIFICATE.pdf | 0.66MB | ~10s | Inline API |
| LOP.pdf | 0.64MB | ~10s | Inline API |
| WEATHER.pdf | 0.87MB | ~10s | Inline API |

## 🛠️ **Maintenance**

This documentation index is maintained alongside code changes. Last updated: **September 19, 2025**

For specific implementation details, refer to the individual documents linked above.