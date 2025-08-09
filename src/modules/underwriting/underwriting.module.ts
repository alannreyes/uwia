import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnderwritingController } from './underwriting.controller';
import { UnderwritingService } from './underwriting.service';
import { OpenAiService } from './services/openai.service';
import { PdfParserService } from './services/pdf-parser.service';
import { PdfImageService } from './services/pdf-image.service';
import { DocumentPrompt } from './entities/document-prompt.entity';
import { ClaimEvaluation } from './entities/claim-evaluation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentPrompt, ClaimEvaluation]),
  ],
  controllers: [UnderwritingController],
  providers: [
    UnderwritingService,
    OpenAiService,
    PdfParserService,
    PdfImageService,
  ],
  exports: [UnderwritingService],
})
export class UnderwritingModule {}