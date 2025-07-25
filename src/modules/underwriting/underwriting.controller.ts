import { Controller, Post, Get, Body, Param, Query, HttpCode, HttpStatus, Logger, Req, UseInterceptors, UploadedFile, UploadedFiles } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { Express } from 'express';
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
    @Body() body: any,
    @Req() req: any
  ): Promise<EvaluateClaimResponseDto> {
    this.logger.log('🔍 Raw request body received:');
    this.logger.log(JSON.stringify(body, null, 2));
    
    this.logger.log('🔍 Type of each field:');
    Object.keys(body || {}).forEach(key => {
      this.logger.log(`${key}: ${typeof body[key]} = ${body[key]}`);
    });

    // File data debugging
    console.log('🔍 File data debug:');
    console.log('File data length:', req.body?.file_data?.length || body.file_data?.length);
    console.log('File data type:', typeof (req.body?.file_data || body.file_data));
    console.log('File data starts with:', (req.body?.file_data || body.file_data)?.substring(0, 50));
    console.log('Is valid base64?', /^[A-Za-z0-9+/=]+$/.test((req.body?.file_data || body.file_data) || ''));

    // PDF files debugging
    console.log('🔍 PDF files debug:');
    console.log('LOP PDF length:', (body.lop_pdf || req.body?.lop_pdf)?.length);
    console.log('LOP PDF type:', typeof (body.lop_pdf || req.body?.lop_pdf));
    console.log('LOP PDF starts with:', (body.lop_pdf || req.body?.lop_pdf)?.substring(0, 50));
    
    console.log('POLICY PDF length:', (body.policy_pdf || req.body?.policy_pdf)?.length);
    console.log('POLICY PDF type:', typeof (body.policy_pdf || req.body?.policy_pdf));
    console.log('POLICY PDF starts with:', (body.policy_pdf || req.body?.policy_pdf)?.substring(0, 50));
    
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

  // Nuevo endpoint para multipart/form-data
  @Post('evaluate-claim-multipart')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'lop_pdf', maxCount: 1 },
    { name: 'policy_pdf', maxCount: 1 },
    { name: 'file_data', maxCount: 1 }  // Para compatibilidad
  ]))
  @HttpCode(HttpStatus.OK)
  async evaluateClaimMultipart(
    @UploadedFiles() files: { 
      lop_pdf?: Express.Multer.File[],
      policy_pdf?: Express.Multer.File[],
      file_data?: Express.Multer.File[]
    },
    @Body() body: any
  ): Promise<EvaluateClaimResponseDto> {
    this.logger.log('📥 Received multipart/form-data request');
    this.logger.log('Body fields:', body);
    this.logger.log('Files received:', Object.keys(files || {}));

    // Convertir archivos a base64
    const lop_pdf = files?.lop_pdf?.[0] ? files.lop_pdf[0].buffer.toString('base64') : undefined;
    const policy_pdf = files?.policy_pdf?.[0] ? files.policy_pdf[0].buffer.toString('base64') : undefined;
    const file_data = files?.file_data?.[0] ? files.file_data[0].buffer.toString('base64') : undefined;

    if (lop_pdf) {
      this.logger.log(`LOP PDF: ${files.lop_pdf[0].originalname} (${files.lop_pdf[0].size} bytes)`);
    }
    if (policy_pdf) {
      this.logger.log(`POLICY PDF: ${files.policy_pdf[0].originalname} (${files.policy_pdf[0].size} bytes)`);
    }
    if (file_data) {
      this.logger.log(`FILE DATA: ${files.file_data[0].originalname} (${files.file_data[0].size} bytes)`);
    }

    // Crear DTO combinando body fields y archivos convertidos
    const dto: EvaluateClaimRequestDto = {
      ...body,
      lop_pdf: lop_pdf || body.lop_pdf,
      policy_pdf: policy_pdf || body.policy_pdf,
      file_data: file_data || body.file_data
    };

    this.logger.log('DTO created:', {
      ...dto,
      lop_pdf: dto.lop_pdf ? `[BASE64 - ${dto.lop_pdf.length} chars]` : undefined,
      policy_pdf: dto.policy_pdf ? `[BASE64 - ${dto.policy_pdf.length} chars]` : undefined,
      file_data: dto.file_data ? `[BASE64 - ${dto.file_data.length} chars]` : undefined
    });

    return this.underwritingService.evaluateClaim(dto);
  }
}