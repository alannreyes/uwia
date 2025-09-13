
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  Logger,
  HttpException,
  HttpStatus,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { EnhancedPdfProcessorService } from '../services/enhanced-pdf-processor.service';
import { RagQueryService } from '../services/rag-query.service';
import { ChunkStorageService } from '../services/chunk-storage.service';
import { ProcessLargePdfDto } from '../dto/process-large-pdf.dto';
import { QueryDocumentDto } from '../dto/query-document.dto';
import { ProcessingResultDto, QueryResultDto, StatusResultDto } from '../dto/processing-result.dto';

@ApiTags('Enhanced UWIA - Large PDF Processing')
@Controller('enhanced-uwia')
export class EnhancedUwiaController {
  private readonly logger = new Logger(EnhancedUwiaController.name);

  constructor(
    private readonly enhancedPdfProcessorService: EnhancedPdfProcessorService,
    private readonly ragQueryService: RagQueryService,
    private readonly chunkStorageService: ChunkStorageService,
  ) {}

  @Post('process-large-pdf')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Process a large PDF asynchronously and create a queryable session.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'PDF file to be processed.',
    type: ProcessLargePdfDto,
  })
  @ApiResponse({ status: 201, description: 'Processing started.', type: ProcessingResultDto })
  async processLargePdf(@UploadedFile() file): Promise<ProcessingResultDto> {
    if (!file) {
      throw new HttpException('No file uploaded.', HttpStatus.BAD_REQUEST);
    }
    this.logger.log(`Received file: ${file.originalname}, size: ${file.size}`);
    
    const session = await this.enhancedPdfProcessorService.processLargePdf(file);

    return {
      sessionId: session.id,
      status: session.status as 'processing' | 'ready',
      estimatedTime: 0, // Placeholder
      totalChunks: session.totalChunks,
    };
  }

  @Post('query/:sessionId')
  @ApiOperation({ summary: 'Query a processed document using its session ID.' })
  @ApiResponse({ status: 200, description: 'Query successful.', type: QueryResultDto })
  async queryDocument(
    @Param('sessionId') sessionId: string,
    @Body() queryDto: QueryDocumentDto,
  ): Promise<QueryResultDto> {
    this.logger.log(`Querying session ${sessionId} with question: "${queryDto.question}"`);
    try {
      return await this.ragQueryService.queryDocument(sessionId, queryDto.question, queryDto.maxResults);
    } catch (error) {
      this.logger.error(`Query failed for session ${sessionId}: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('status/:sessionId')
  @ApiOperation({ summary: 'Get the processing status of a document session.' })
  @ApiResponse({ status: 200, description: 'Status retrieved.', type: StatusResultDto })
  async getProcessingStatus(@Param('sessionId') sessionId: string): Promise<StatusResultDto> {
    const session = await this.chunkStorageService.getSession(sessionId);
    if (!session) {
      throw new HttpException('Session not found.', HttpStatus.NOT_FOUND);
    }

    const progress = session.totalChunks > 0 ? (session.processedChunks / session.totalChunks) * 100 : 0;

    return {
      status: session.status,
      progress: Math.round(progress),
      chunksProcessed: session.processedChunks,
      totalChunks: session.totalChunks,
      estimatedTimeRemaining: 0, // Placeholder
    };
  }

  @Delete('session/:sessionId')
  @ApiOperation({ summary: 'Manually delete a processing session and its chunks.' })
  @ApiResponse({ status: 204, description: 'Session deleted successfully.' })
  async deleteSession(@Param('sessionId') sessionId: string): Promise<void> {
    this.logger.log(`Request to delete session ${sessionId}`);
    await this.chunkStorageService.deleteSession(sessionId);
  }
}
