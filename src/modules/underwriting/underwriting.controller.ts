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

  // Nuevo endpoint para multipart/form-data - Flexible
  @Post('evaluate-claim-multipart')
  @UseInterceptors(FilesInterceptor('file', 10)) // Acepta cualquier archivo con nombre 'file'
  @HttpCode(HttpStatus.OK)
  async evaluateClaimMultipart(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: any
  ): Promise<EvaluateClaimResponseDto> {
    this.logger.log('📥 Received multipart/form-data request');
    this.logger.log('Body fields:', body);
    this.logger.log('Files received:', files?.length || 0);

    // Log cada archivo recibido
    files?.forEach((file, index) => {
      this.logger.log(`File ${index + 1}: ${file.originalname} (${file.size} bytes, ${file.mimetype})`);
    });

    // Procesar el archivo (tomar el primero si hay varios)
    const uploadedFile = files?.[0];
    let fileBase64: string | undefined;
    let document_name = body.document_name;

    if (uploadedFile) {
      fileBase64 = uploadedFile.buffer.toString('base64');
      this.logger.log(`File converted to base64: ${fileBase64.length} characters`);
      
      // Si no hay document_name en el body, extraerlo del nombre del archivo
      if (!document_name && uploadedFile.originalname) {
        document_name = uploadedFile.originalname.replace(/\.pdf$/i, '');
        this.logger.log(`Document name extracted from file: ${document_name}`);
      }
    }

    // Extraer context si viene como string JSON
    let context = body.context;
    if (typeof context === 'string') {
      try {
        context = JSON.parse(context);
        this.logger.log('Context parsed from JSON string');
      } catch (e) {
        this.logger.warn('Failed to parse context as JSON, using as string');
      }
    }

    // Crear DTO flexible basado en document_name
    const dto: any = {
      record_id: body.record_id,
      carpeta_id: body.carpeta_id,
      document_name: document_name,
      context: context,
      // Asignar el archivo según el document_name
      ...(document_name === 'LOP' && { lop_pdf: fileBase64 }),
      ...(document_name === 'POLICY' && { policy_pdf: fileBase64 }),
      // Fallback para cualquier archivo
      file_data: fileBase64,
      // Incluir todos los demás campos del body
      ...body
    };

    this.logger.log('DTO created:', {
      ...dto,
      lop_pdf: dto.lop_pdf ? `[BASE64 - ${dto.lop_pdf.length} chars]` : undefined,
      policy_pdf: dto.policy_pdf ? `[BASE64 - ${dto.policy_pdf.length} chars]` : undefined,
      file_data: dto.file_data ? `[BASE64 - ${dto.file_data.length} chars]` : undefined,
      context: typeof dto.context
    });

    return this.underwritingService.evaluateClaim(dto);
  }
}