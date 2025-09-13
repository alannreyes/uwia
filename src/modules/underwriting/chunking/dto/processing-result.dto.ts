
import { ApiProperty } from '@nestjs/swagger';

export class ProcessingResultDto {
  @ApiProperty()
  sessionId: string;

  @ApiProperty({ enum: ['processing', 'ready'] })
  status: 'processing' | 'ready';

  @ApiProperty()
  estimatedTime: number;

  @ApiProperty()
  totalChunks: number;
}

export class QueryResultDto {
    @ApiProperty()
    answer: string;

    @ApiProperty()
    confidence: number;

    @ApiProperty()
    sourceChunks: string[];

    @ApiProperty()
    processingTime: number;
}

export class StatusResultDto {
    @ApiProperty()
    status: string;

    @ApiProperty()
    progress: number;

    @ApiProperty()
    chunksProcessed: number;

    @ApiProperty()
    totalChunks: number;

    @ApiProperty()
    estimatedTimeRemaining: number;
}
