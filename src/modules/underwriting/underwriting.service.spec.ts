import { UnderwritingService } from './underwriting.service';

// Create minimal stubs for dependencies
const repoStub: any = { manager: { connection: { createQueryRunner: () => ({ connect: async () => {}, release: async () => {}, query: async () => [] }) } } };
const simpleStub: any = {};

function createService(): UnderwritingService {
  return new UnderwritingService(
    repoStub,
    repoStub,
    simpleStub, // OpenAiService
    simpleStub, // PdfParserService
    simpleStub, // PdfFormExtractorService
    simpleStub, // PdfHybridAnalyzerService
    simpleStub, // PdfStreamProcessorService
    simpleStub, // PdfToolkitService
    simpleStub, // PdfImageServiceV2
    simpleStub, // PdfImageService
    simpleStub, // AdaptiveProcessingStrategyService
    simpleStub, // IntelligentPageSelectorService
    simpleStub, // LargePdfVisionService
    simpleStub, // EnhancedPdfProcessorService
    simpleStub, // ModernRagService
    simpleStub, // VectorStorageService
    simpleStub, // SemanticChunkingService
  );
}

describe('UnderwritingService variable replacement', () => {
  it('replaces placeholders with provided values', () => {
    const svc = createService() as any;
    const prompt = 'Compare %insured_name% with %insurance_company% on %date_of_loss%';
    const vars = {
      '%insured_name%': 'John Doe',
      '%insurance_company%': 'Acme Insurance',
      '%date_of_loss%': '06-22-25',
    } as Record<string, string>;
    const result = svc.replaceVariablesInPrompt(prompt, vars);
    expect(result).toBe('Compare John Doe with Acme Insurance on 06-22-25');
  });

  it('removes placeholders when values are empty', () => {
    const svc = createService() as any;
    const prompt = 'Compare %insured_name% with %insurance_company% on %date_of_loss%';
    const vars = {
      '%insured_name%': '',
      '%insurance_company%': 'Acme',
      '%date_of_loss%': '',
    } as Record<string, string>;
    const result = svc.replaceVariablesInPrompt(prompt, vars);
    expect(result).toBe('Compare  with Acme on ');
    // Ensure no leftover %placeholders%
    expect(result.includes('%insured_name%')).toBe(false);
    expect(result.includes('%date_of_loss%')).toBe(false);
  });

  it('escapes regex special characters in keys', () => {
    const svc = createService() as any;
    const prompt = 'Value for %[.*]var%?';
    const vars = { '%[.*]var%': 'X' } as Record<string, string>;
    const result = svc.replaceVariablesInPrompt(prompt, vars);
    expect(result).toBe('Value for X?');
  });
});
