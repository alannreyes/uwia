import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class VariableHandlerService {
  private readonly logger = new Logger(VariableHandlerService.name);

  /**
   * Enhanced variable replacement that handles empty variables intelligently
   */
  replaceVariablesInPrompt(prompt: string, variables: Record<string, string>): string {
    let replacedPrompt = prompt;
    let replacements = 0;

    for (const key in variables) {
      const value = variables[key] ?? '';

      if (replacedPrompt.includes(key)) {
        // Handle empty variables specially for comparison prompts
        if (!value && replacedPrompt.includes(`compare with ${key}`)) {
          // Replace the entire comparison instruction
          const comparePattern = new RegExp(
            `compare with ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]*\\.`,
            'gi'
          );
          replacedPrompt = replacedPrompt.replace(
            comparePattern,
            'extract and return the value found in the document.'
          );
          this.logger.log(`🔄 Empty variable ${key} - modified comparison instruction`);
        } else {
          // Standard replacement
          const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          replacedPrompt = replacedPrompt.replace(new RegExp(escaped, 'g'), value);
          replacements++;

          if (value) {
            this.logger.log(`✅ Replaced ${key} with value (${value.length} chars)`);
          } else {
            this.logger.warn(`⚠️ Replaced ${key} with empty string`);
          }
        }
      }
    }

    if (replacements > 0) {
      this.logger.log(`📝 Total replacements: ${replacements}`);
    }

    return replacedPrompt;
  }

  /**
   * Validate required variables and provide warnings
   */
  validateRequiredVariables(
    prompt: string,
    variables: Record<string, string>,
    documentName: string
  ): string[] {
    const warnings: string[] = [];
    const variablePattern = /%[a-z_]+%/gi;
    const requiredVars = prompt.match(variablePattern) || [];

    for (const varName of requiredVars) {
      if (!variables[varName] || variables[varName] === '') {
        warnings.push(`Missing required variable ${varName} for ${documentName}`);
        this.logger.warn(`⚠️ ${documentName}: Variable ${varName} is empty or missing`);
      }
    }

    return warnings;
  }

  /**
   * Extract variable value from document content if missing
   */
  async extractVariableFromContent(
    variableName: string,
    documentContent: string
  ): Promise<string | null> {
    // Map variable names to extraction patterns
    const extractionPatterns: Record<string, RegExp> = {
      '%insurance_company%': /(?:Insurance Company|Insurer|Carrier|Underwriter):\s*([^\n]+)/i,
      '%insured_name%': /(?:Insured|Policyholder|Named Insured):\s*([^\n]+)/i,
      '%policy_number%': /(?:Policy Number|Policy No|Policy #):\s*([^\n]+)/i,
      '%claim_number%': /(?:Claim Number|Claim No|Claim #):\s*([^\n]+)/i,
    };

    const pattern = extractionPatterns[variableName];
    if (!pattern) return null;

    const match = documentContent.match(pattern);
    if (match && match[1]) {
      const extracted = match[1].trim();
      this.logger.log(`📤 Extracted ${variableName} from document: "${extracted}"`);
      return extracted;
    }

    return null;
  }
}