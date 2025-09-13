import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { EnhancedUwiaController } from './controllers/enhanced-uwia.controller';
import { PdfProcessingSession } from './entities/pdf-processing-session.entity';
import { PdfChunk } from './entities/pdf-chunk.entity';
import { EnhancedPdfProcessorService } from './services/enhanced-pdf-processor.service';
import { MemoryManagerService } from './services/memory-manager.service';
import { ChunkStorageService } from './services/chunk-storage.service';
import { RagQueryService } from './services/rag-query.service';
import { SessionCleanupService } from './services/session-cleanup.service';
import { UnderwritingModule } from '../underwriting.module';
import { PdfParserService } from '../services/pdf-parser.service';
import { OpenAiService } from '../services/openai.service';
import { PdfFormExtractorService } from '../services/pdf-form-extractor.service';
import { JudgeValidatorService } from '../services/judge-validator.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PdfProcessingSession, PdfChunk]),
    ScheduleModule.forRoot(),
  ],
  controllers: [EnhancedUwiaController],
  providers: [
    EnhancedPdfProcessorService,
    ChunkStorageService,
    MemoryManagerService,
    SessionCleanupService,
    RagQueryService,
  ],
  exports: [EnhancedPdfProcessorService, RagQueryService],
})
export class ChunkingModule {}
