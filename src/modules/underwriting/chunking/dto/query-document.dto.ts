
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';

export class QueryDocumentDto {
  @ApiProperty({ description: 'The question to ask the document.' })
  @IsString()
  @IsNotEmpty()
  question: string;

  @ApiProperty({ description: 'The maximum number of results to return.', required: false, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxResults?: number;
}
