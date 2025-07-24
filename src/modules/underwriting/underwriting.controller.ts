import { Controller, Post, Get, Body, Param, Query, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { UnderwritingService } from './underwriting.service';
import { EvaluateClaimRequestDto } from './dto/evaluate-claim-request.dto';
import { EvaluateClaimResponseDto } from './dto/evaluate-claim-response.dto';

@Controller('underwriting')
export class UnderwritingController {
  private readonly logger = new Logger(UnderwritingController.name);
  
  constructor(private readonly underwritingService: UnderwritingService) {}

  @Post('evaluate-claim')
  @HttpCode(HttpStatus.OK)
  async evaluateClaim(
    @Body() body: any
  ): Promise<EvaluateClaimResponseDto> {
    this.logger.log('🔍 Raw request body received:');
    this.logger.log(JSON.stringify(body, null, 2));
    
    this.logger.log('🔍 Type of each field:');
    Object.keys(body || {}).forEach(key => {
      this.logger.log(`${key}: ${typeof body[key]} = ${body[key]}`);
    });
    
    // Cast to DTO for validation
    const dto = body as EvaluateClaimRequestDto;
    return this.underwritingService.evaluateClaim(dto);
  }

  @Get('document-prompts')
  async getDocumentPrompts(@Query('document') documentName?: string) {
    return this.underwritingService.getDocumentPrompts(documentName);
  }

  @Get('claim-history/:claimReference')
  async getClaimHistory(@Param('claimReference') claimReference: string) {
    return this.underwritingService.getClaimHistory(claimReference);
  }

  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'uwia',
    };
  }
}