import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnderwritingController } from './underwriting.controller';
import { UnderwritingService } from './underwriting.service';
import { OpenAiService } from './services/openai.service';
import { PdfParserService } from './services/pdf-parser.service';
import { PdfFormExtractorService } from './services/pdf-form-extractor.service';
import { PdfHybridAnalyzerService } from './services/pdf-hybrid-analyzer.service';
import { PdfStreamProcessorService } from './services/pdf-stream-processor.service';
import { PdfImageService } from './services/pdf-image.service';
import { VisualClassifierService } from './services/visual-classifier.service';
import { JudgeValidatorService } from './services/judge-validator.service';
import { AdaptiveProcessingStrategyService } from './services/adaptive-processing-strategy.service';
import { IntelligentPageSelectorService } from './services/intelligent-page-selector.service';
import { LargePdfVisionService } from './services/large-pdf-vision.service';
import { GeminiService } from './services/gemini.service';
import { RateLimiterService } from './services/rate-limiter.service';
import { DocumentPrompt } from './entities/document-prompt.entity';
import { ClaimEvaluation } from './entities/claim-evaluation.entity';
import { ConfigService } from '@nestjs/config';

import { ChunkingModule } from './chunking/chunking.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Claim,
      Document,
      ClaimHistory,
      DocumentPrompt,
      DocumentPromptV2,
    ]),
    ChunkingModule,
  ],
  controllers: [UnderwritingController],
  providers: [
    UnderwritingService,
    OpenAiService,
    PdfParserService,
    PdfFormExtractorService,
    PdfHybridAnalyzerService,
    PdfStreamProcessorService,
    PdfImageService,
    VisualClassifierService,
    JudgeValidatorService,
    AdaptiveProcessingStrategyService,
    IntelligentPageSelectorService,
    LargePdfVisionService,
    GeminiService,
    RateLimiterService,
    ConfigService,
  ],
  exports: [UnderwritingService],
})
export class UnderwritingModule {}