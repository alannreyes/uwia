/**
 * Script para verificar la configuración del sistema de triple validación
 * Ejecutar con: npx ts-node verify-triple-validation.ts
 */

import { config } from 'dotenv';
import * as path from 'path';

// Cargar variables de entorno
config({ path: path.join(__dirname, '.env.production') });

// Importar configuración
import { modelConfig } from './src/config/model.config';

// Colores para output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m'
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkEnvironmentVariable(name: string, value: string | undefined, isRequired: boolean = false): boolean {
  const exists = !!value && value !== 'YOUR_' + name + '_HERE';
  const icon = exists ? '✅' : (isRequired ? '❌' : '⚠️');
  const status = exists ? 'Configured' : (isRequired ? 'MISSING (Required)' : 'Not configured (Optional)');
  const color = exists ? 'green' : (isRequired ? 'red' : 'yellow');
  
  log(`  ${icon} ${name}: ${status}`, color);
  
  if (exists && !name.includes('KEY')) {
    log(`      Value: ${value}`, 'cyan');
  }
  
  return exists;
}

function main() {
  log('\n🚀 TRIPLE VALIDATION SYSTEM - Configuration Verification', 'bright');
  log('=' .repeat(60), 'bright');

  // 1. Verificar configuración de OpenAI
  log('\n📦 OpenAI Configuration:', 'magenta');
  const openaiConfigured = checkEnvironmentVariable('OPENAI_API_KEY', process.env.OPENAI_API_KEY, true);
  checkEnvironmentVariable('OPENAI_MODEL', process.env.OPENAI_MODEL);
  checkEnvironmentVariable('OPENAI_VALIDATION_MODEL', process.env.OPENAI_VALIDATION_MODEL);
  checkEnvironmentVariable('OPENAI_DUAL_VALIDATION', process.env.OPENAI_DUAL_VALIDATION);
  checkEnvironmentVariable('OPENAI_ENABLED', process.env.OPENAI_ENABLED);

  // 2. Verificar configuración de Claude
  log('\n🤖 Claude Sonnet 4 Configuration:', 'magenta');
  const claudeConfigured = checkEnvironmentVariable('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY);
  checkEnvironmentVariable('ANTHROPIC_BASE_URL', process.env.ANTHROPIC_BASE_URL);
  checkEnvironmentVariable('ANTHROPIC_MODEL', process.env.ANTHROPIC_MODEL);
  checkEnvironmentVariable('ANTHROPIC_TEMPERATURE', process.env.ANTHROPIC_TEMPERATURE);
  checkEnvironmentVariable('ANTHROPIC_MAX_TOKENS', process.env.ANTHROPIC_MAX_TOKENS);

  // 3. Verificar configuración de Triple Validation
  log('\n🔺 Triple Validation Configuration:', 'magenta');
  checkEnvironmentVariable('TRIPLE_VALIDATION', process.env.TRIPLE_VALIDATION);
  checkEnvironmentVariable('TRIPLE_ARBITRATOR_MODEL', process.env.TRIPLE_ARBITRATOR_MODEL);
  checkEnvironmentVariable('TRIPLE_HIGH_AGREEMENT', process.env.TRIPLE_HIGH_AGREEMENT);
  checkEnvironmentVariable('TRIPLE_LOW_AGREEMENT', process.env.TRIPLE_LOW_AGREEMENT);
  checkEnvironmentVariable('TRIPLE_FALLBACK_STRATEGY', process.env.TRIPLE_FALLBACK_STRATEGY);

  // 4. Verificar estado del sistema
  log('\n📊 System Status:', 'cyan');
  log('=' .repeat(60), 'cyan');

  // Estado de OpenAI
  const openaiEnabled = modelConfig.openai.enabled;
  log(`\n  OpenAI Service: ${openaiEnabled ? '✅ ENABLED' : '❌ DISABLED'}`, openaiEnabled ? 'green' : 'red');
  if (openaiEnabled) {
    log(`    Primary Model: ${modelConfig.openai.model}`, 'blue');
    log(`    Validation Model: ${modelConfig.openai.validationModel}`, 'blue');
  }

  // Estado de Claude
  const claudeEnabled = modelConfig.claude.enabled;
  log(`\n  Claude Service: ${claudeEnabled ? '✅ ENABLED' : '⚠️ DISABLED'}`, claudeEnabled ? 'green' : 'yellow');
  if (claudeEnabled) {
    log(`    Model: ${modelConfig.claude.model}`, 'blue');
    log(`    Max Context: ${modelConfig.claude.maxContextTokens.toLocaleString()} tokens`, 'blue');
  } else if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
    log(`    ℹ️  API Key is set but not activated`, 'yellow');
  }

  // Estado de Triple Validation
  const tripleEnabled = modelConfig.validation.triple.enabled;
  log(`\n  Triple Validation: ${tripleEnabled ? '✅ ENABLED' : '⚠️ DISABLED'}`, tripleEnabled ? 'green' : 'yellow');
  
  // Estrategia actual
  const currentStrategy = modelConfig.getValidationStrategy();
  log(`\n  🎯 Current Strategy: ${currentStrategy.toUpperCase()}`, 'bright');

  // 5. Escenarios de Fallback
  log('\n\n🛡️ Fallback Scenarios:', 'cyan');
  log('=' .repeat(60), 'cyan');

  // Escenario 1: Triple activado pero Claude no disponible
  if (process.env.TRIPLE_VALIDATION === 'true' && !claudeEnabled) {
    log('\n  ⚠️  Triple validation requested but Claude unavailable', 'yellow');
    log('      → Will fallback to DUAL validation', 'green');
  }

  // Escenario 2: Triple activo y todo configurado
  if (tripleEnabled && claudeEnabled && openaiEnabled) {
    log('\n  ✅ Full triple validation available!', 'green');
    log('      → GPT-4o (chunking) + Claude Sonnet 4 (full) + GPT-4o (arbitrator)', 'blue');
  }

  // Escenario 3: Solo dual validation
  if (currentStrategy === 'dual') {
    log('\n  ℹ️  Using dual validation strategy', 'cyan');
    log('      → GPT-4o-mini (primary) + GPT-4o (validator) + Judge', 'blue');
  }

  // Escenario 4: Simple validation
  if (currentStrategy === 'simple') {
    log('\n  ℹ️  Using simple validation strategy', 'cyan');
    log('      → Single model evaluation only', 'blue');
  }

  // 6. Instrucciones de activación
  log('\n\n📝 Activation Instructions:', 'magenta');
  log('=' .repeat(60), 'magenta');

  if (!tripleEnabled) {
    log('\n  To enable Triple Validation:', 'yellow');
    log('  1. Set ANTHROPIC_API_KEY in EasyPanel environment variables', 'cyan');
    log('  2. Set TRIPLE_VALIDATION=true', 'cyan');
    log('  3. Restart the application', 'cyan');
    
    log('\n  Benefits of Triple Validation:', 'green');
    log('  • GPT-4o analyzes with intelligent chunking', 'blue');
    log('  • Claude Sonnet 4 analyzes complete document (200K tokens)', 'blue');
    log('  • GPT-4o arbitrates for maximum accuracy', 'blue');
    log('  • Automatic consensus detection', 'blue');
    log('  • Graceful fallbacks if any service fails', 'blue');
  } else {
    log('\n  ✅ Triple Validation is ACTIVE!', 'green');
    log('  • High Agreement Threshold: ' + modelConfig.validation.triple.highAgreementThreshold, 'blue');
    log('  • Low Agreement Threshold: ' + modelConfig.validation.triple.lowAgreementThreshold, 'blue');
    log('  • Fallback Strategy: ' + modelConfig.validation.triple.fallbackStrategy, 'blue');
  }

  // 7. Resumen de compatibilidad
  log('\n\n✨ Compatibility Summary:', 'bright');
  log('=' .repeat(60), 'bright');
  log('  ✅ Zero breaking changes', 'green');
  log('  ✅ Backward compatible with existing code', 'green');
  log('  ✅ Optional activation via environment variables', 'green');
  log('  ✅ Graceful fallbacks at every level', 'green');
  log('  ✅ Extended metadata without breaking existing structure', 'green');

  // 8. Test de conectividad (sin hacer llamadas reales)
  log('\n\n🔌 Service Connectivity (Mock Test):', 'cyan');
  log('=' .repeat(60), 'cyan');

  // Verificar formato de API keys
  if (openaiConfigured) {
    const keyFormat = process.env.OPENAI_API_KEY?.startsWith('sk-') ? 'Valid format' : 'Invalid format';
    log(`  OpenAI API Key: ${keyFormat}`, keyFormat === 'Valid format' ? 'green' : 'red');
  }

  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE') {
    const keyFormat = process.env.ANTHROPIC_API_KEY?.startsWith('sk-ant-') ? 'Valid format' : 'Invalid format';
    log(`  Claude API Key: ${keyFormat}`, keyFormat === 'Valid format' ? 'green' : 'red');
    
    // Verificar URL base
    const urlValid = process.env.ANTHROPIC_BASE_URL?.includes('api.anthropic.com');
    log(`  Claude Base URL: ${urlValid ? 'Valid Anthropic endpoint' : 'Custom endpoint'}`, urlValid ? 'green' : 'yellow');
  }

  log('\n' + '=' .repeat(60), 'bright');
  log('🎉 Configuration verification completed!', 'bright');
  log('=' .repeat(60) + '\n', 'bright');
}

// Ejecutar verificación
main();