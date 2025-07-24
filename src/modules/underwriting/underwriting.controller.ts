import { Controller, Post, Get, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { UnderwritingService } from './underwriting.service';
import { EvaluateClaimRequestDto } from './dto/evaluate-claim-request.dto';
import { EvaluateClaimResponseDto } from './dto/evaluate-claim-response.dto';

@Controller('underwriting')
export class UnderwritingController {
  constructor(private readonly underwritingService: UnderwritingService) {}

  @Post('evaluate-claim')
  @HttpCode(HttpStatus.OK)
  async evaluateClaim(
    @Body() dto: EvaluateClaimRequestDto
  ): Promise<EvaluateClaimResponseDto> {
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