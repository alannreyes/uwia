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
import { EnhancedPdfProcessorService } from './chunking/services/enhanced-pdf-processor.service';
import { ModernRagService } from './services/modern-rag.service';
import { VectorStorageService } from './services/vector-storage.service';
import { SemanticChunkingService } from './services/semantic-chunking.service';
import { OpenAIEmbeddingsService } from './services/openai-embeddings.service';
import { DocumentPrompt } from './entities/document-prompt.entity';
import { ClaimEvaluation } from './entities/claim-evaluation.entity';
import { DocumentEmbedding } from './chunking/entities/document-embedding.entity';
import { VectorQuery } from './chunking/entities/vector-query.entity';
import { ConfigService } from '@nestjs/config';

import { ChunkingModule } from './chunking/chunking.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentPrompt,
      ClaimEvaluation,
      DocumentEmbedding,
      VectorQuery,
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
    EnhancedPdfProcessorService,
    ModernRagService,
    VectorStorageService,
    SemanticChunkingService,
    OpenAIEmbeddingsService,
    ConfigService,
  ],
  exports: [UnderwritingService],
})
export class UnderwritingModule {}