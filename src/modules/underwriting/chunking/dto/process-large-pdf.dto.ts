
import { ApiProperty } from '@nestjs/swagger';

export class ProcessLargePdfDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'The large PDF file to process.' })
  file: any;
}
