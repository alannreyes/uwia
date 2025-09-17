import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnderwritingController } from './underwriting.controller';
import { RagDebugController } from './controllers/rag-debug.controller';
import { UnderwritingService } from './underwriting.service';
import { PdfFormExtractorService } from './services/pdf-form-extractor.service';
import { PdfHybridAnalyzerService } from './services/pdf-hybrid-analyzer.service';
import { PdfStreamProcessorService } from './services/pdf-stream-processor.service';
import { PdfImageService } from './services/pdf-image.service';
import { PdfToolkitService } from './services/pdf-toolkit.service';
import { PdfImageServiceV2 } from './services/pdf-image-v2.service';
import { VisualClassifierService } from './services/visual-classifier.service';
import { JudgeValidatorService } from './services/judge-validator.service';
import { AdaptiveProcessingStrategyService } from './services/adaptive-processing-strategy.service';
import { IntelligentPageSelectorService } from './services/intelligent-page-selector.service';
import { LargePdfVisionService } from './services/large-pdf-vision.service';
import { GeminiService } from './services/gemini.service';
import { GeminiFileApiService } from './services/gemini-file-api.service';
import { RateLimiterService } from './services/rate-limiter.service';
import { ModernRagService } from './services/modern-rag.service';
import { VectorStorageService } from './services/vector-storage.service';
import { SemanticChunkingService } from './services/semantic-chunking.service';
import { OpenAIEmbeddingsService } from './services/openai-embeddings.service';
import { DocumentPrompt } from './entities/document-prompt.entity';
import { ClaimEvaluation } from './entities/claim-evaluation.entity';
import { DocumentEmbedding } from './chunking/entities/document-embedding.entity';
import { VectorQuery } from './chunking/entities/vector-query.entity';
import { ConfigService } from '@nestjs/config';
import { ProcessingOrchestratorService } from './orchestration/processing-orchestrator.service';
import { OcrService } from './services/ocr.service';

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
  controllers: [UnderwritingController, RagDebugController],
  providers: [
    UnderwritingService,
    ProcessingOrchestratorService,
    OcrService,
    // Services not provided by ChunkingModule
    PdfFormExtractorService,
    PdfHybridAnalyzerService,
    PdfStreamProcessorService,
    PdfToolkitService,        // NEW: Unified PDF toolkit
    PdfImageServiceV2,        // NEW: Enhanced image service
    PdfImageService,          // Keep for backward compatibility
    VisualClassifierService,
    JudgeValidatorService,
    AdaptiveProcessingStrategyService,
    IntelligentPageSelectorService,
    LargePdfVisionService,
    GeminiService,
    GeminiFileApiService,
    RateLimiterService,
    ModernRagService,
    VectorStorageService,
    SemanticChunkingService,
    OpenAIEmbeddingsService,
    ConfigService,
  ],
  exports: [UnderwritingService],
})
export class UnderwritingModule {}