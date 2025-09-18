const fs = require('fs');
const path = require('path');

// Importar el servicio
const { UnderwritingService } = require('./dist/src/modules/underwriting/underwriting.service');
const { GeminiFileApiService } = require('./dist/src/modules/underwriting/services/gemini-file-api.service');

async function testPolicy66MB() {
    console.log('🧪 Test: POLICY.pdf 66MB con formato correcto');
    console.log('=' .repeat(60));
    
    try {
        // Cargar archivo
        const policyPath = path.join(__dirname, 'docs2', 'POLICY.pdf');
        
        if (!fs.existsSync(policyPath)) {
            console.error('❌ Archivo no encontrado:', policyPath);
            return;
        }
        
        const pdfBuffer = fs.readFileSync(policyPath);
        const fileSizeMB = pdfBuffer.length / (1024 * 1024);
        
        console.log(`📄 Archivo: ${policyPath}`);
        console.log(`📊 Tamaño: ${fileSizeMB.toFixed(2)}MB`);
        console.log('');
        
        // Verificar variables de entorno
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
            console.error('❌ GEMINI_API_KEY no configurada');
            return;
        }
        
        if (process.env.GEMINI_ENABLED !== 'true') {
            console.error('❌ GEMINI_ENABLED debe ser true');
            return;
        }
        
        console.log('✅ Variables de entorno configuradas correctamente');
        console.log('');
        
        // Crear instancia del servicio
        const geminiService = new GeminiFileApiService();
        
        if (!geminiService.isAvailable()) {
            console.error('❌ GeminiFileApiService no está disponible');
            return;
        }
        
        console.log('✅ GeminiFileApiService inicializado correctamente');
        console.log('');
        
        // Prompt para POLICY.pdf (exactamente como en el sistema)
        const prompt = `Extract the following 7 data points from this insurance policy document: 1. policy_valid_from1: Find the policy start or effective date when coverage begins. Convert to MM-DD-YY format. Return the earliest date if multiple exist or NOT_FOUND. 2. policy_valid_to1: Find the policy expiration or end date when coverage ends. Convert to MM-DD-YY format. Return the latest date if multiple exist or NOT_FOUND. 3. matching_insured_name: Extract the primary insured or policyholder full name and compare with NELSON ZAMOT,dont look for an exact match. Return YES if they match or NO if different. 4. matching_insured_company: Extract the insurance company name and compare with , dont look for an exact match. Return YES if they represent the same company or NO if different. 5. policy_covers_type_job: Return YES if the policy explicitly covers wind, storm, weather damage. Return NO only if Dryout,Tarp,Retarp is explicitly excluded. 6. policy_exclusion: List only the specific Wind exclusions found in the policy. If multiple exclusions exist, separate with commas. Return NOT_FOUND if no wind exclusions exist. 7. policy_covers_dol: Compare 04-11-25 with the policy effective dates from fields 1 and 2 above. Return YES if 04-11-25 falls between policy_valid_from1 and policy_valid_to1. Return NO if the date is before policy_valid_from1 or after policy_valid_to1. Focus only on date ranges, ignore coverage details. Return EXACTLY in this format with semicolons as separators: policy_valid_from1;policy_valid_to1;matching_insured_name;matching_insured_company;policy_covers_type_job;policy_exclusion;policy_covers_dol`;
        
        console.log('📝 Ejecutando análisis...');
        const startTime = Date.now();
        
        // Procesar con Gemini File API
        const result = await geminiService.processPdfDocument(pdfBuffer, prompt);
        
        const processingTime = Date.now() - startTime;
        
        console.log('');
        console.log('✅ RESULTADOS:');
        console.log('-'.repeat(40));
        console.log(`📄 Método: ${result.method}`);
        console.log(`⏱️  Tiempo: ${(processingTime / 1000).toFixed(2)}s`);
        console.log(`🎯 Confianza: ${result.confidence}`);
        console.log(`🔧 Modelo: ${result.model}`);
        console.log(`🎫 Tokens: ${result.tokensUsed}`);
        console.log('');
        console.log('📋 RESPUESTA:');
        console.log(`"${result.response}"`);
        console.log('');
        
        // Validar formato
        const responseParts = result.response.split(';');
        console.log('🔍 VALIDACIÓN DE FORMATO:');
        console.log(`📊 Campos esperados: 7`);
        console.log(`📊 Campos encontrados: ${responseParts.length}`);
        
        if (responseParts.length === 7) {
            console.log('✅ Formato correcto');
            console.log('');
            console.log('📋 CAMPOS EXTRAÍDOS:');
            console.log(`1. policy_valid_from1: "${responseParts[0]}"`);
            console.log(`2. policy_valid_to1: "${responseParts[1]}"`);
            console.log(`3. matching_insured_name: "${responseParts[2]}"`);
            console.log(`4. matching_insured_company: "${responseParts[3]}"`);
            console.log(`5. policy_covers_type_job: "${responseParts[4]}"`);
            console.log(`6. policy_exclusion: "${responseParts[5]}"`);
            console.log(`7. policy_covers_dol: "${responseParts[6]}"`);
        } else {
            console.log('❌ Formato incorrecto');
            console.log('🔍 Respuesta completa para debugging:');
            console.log(result.response);
        }
        
        if (result.reasoning) {
            console.log('');
            console.log('💭 Razonamiento:');
            console.log(result.reasoning);
        }
        
    } catch (error) {
        console.error('❌ Error durante el test:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Ejecutar test
testPolicy66MB().then(() => {
    console.log('');
    console.log('🏁 Test completado');
    process.exit(0);
}).catch(error => {
    console.error('💥 Error fatal:', error);
    process.exit(1);
});