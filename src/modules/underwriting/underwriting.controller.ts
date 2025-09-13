import { Controller, Post, Get, Body, Param, Query, HttpCode, HttpStatus, Logger, Req, UseInterceptors, UploadedFile, UploadedFiles } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { Express } from 'express';
import { UnderwritingService } from './underwriting.service';
import { EvaluateClaimRequestDto } from './dto/evaluate-claim-request.dto';
import { EvaluateClaimResponseDto } from './dto/evaluate-claim-response.dto';
import { EvaluateClaimBatchRequestDto } from './dto/evaluate-claim-batch-request.dto';
import { EnhancedPdfProcessorService } from './chunking/services/enhanced-pdf-processor.service';
import { ConfigService } from '@nestjs/config';

@Controller('underwriting')
export class UnderwritingController {
  private readonly logger = new Logger(UnderwritingController.name);
  
  constructor(
    private readonly underwritingService: UnderwritingService,
    private readonly enhancedPdfProcessorService: EnhancedPdfProcessorService,
    private readonly configService: ConfigService,
  ) {}

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
    @Body() body: any,
  ): Promise<EvaluateClaimResponseDto> {
    this.logger.log('📥 Received multipart/form-data request');
    this.logger.log('Body fields:', body);
    this.logger.log('Files received:', files?.length || 0);

    // Log cada archivo recibido
    files?.forEach((file, index) => {
      this.logger.log(
        `File ${index + 1}: ${file.originalname} (${file.size} bytes, ${
          file.mimetype
        })`,
      );
    });

    // Procesar el archivo (tomar el primero si hay varios)
    const uploadedFile = files?.[0];
    let fileBase64: string | undefined;
    let document_name = body.document_name;

    if (uploadedFile) {
      const largeFileThreshold = this.configService.get<number>('LARGE_FILE_THRESHOLD_BYTES');
      
      if (uploadedFile.size > largeFileThreshold) {
        this.logger.log(`🐘 Large file detected: ${uploadedFile.originalname} (${(uploadedFile.size / 1024 / 1024).toFixed(2)} MB)`);
        
        // Iniciar procesamiento síncrono para archivos grandes
        return this.underwritingService.processLargeFileSynchronously(
          uploadedFile,
          body,
        );
      }

      try {
        // Log del tamaño del archivo
        const fileSizeMB = (uploadedFile.size / 1048576).toFixed(2);
        this.logger.log(`Processing file: ${uploadedFile.originalname} (${fileSizeMB}MB)`);
        
        // Validación adicional de tamaño (aunque Multer ya lo maneja)
        const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 52428800;
        if (uploadedFile.size > maxSize) {
          throw new Error(`File too large: ${fileSizeMB}MB exceeds ${(maxSize/1048576).toFixed(2)}MB limit`);
        }
        
        fileBase64 = uploadedFile.buffer.toString('base64');
        this.logger.log(`File converted to base64: ${fileBase64.length} characters`);
        
        // Si no hay document_name en el body, extraerlo del nombre del archivo
        if (!document_name && uploadedFile.originalname) {
          document_name = uploadedFile.originalname.replace(/\.pdf$/i, '');
          this.logger.log(`Document name extracted from file: ${document_name}`);
        }
      } catch (error) {
        this.logger.error(`❌ Error processing file ${uploadedFile.originalname}:`, error.message);
        // Continuar sin el archivo en lugar de fallar completamente
        this.logger.warn(`⚠️ Continuing without file data due to processing error`);
        fileBase64 = undefined;
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

    // Crear DTO flexible basado en document_name (evitar sobrescribir context parseado)
    // Primero copiar el body crudo, luego forzar campos normalizados
    const dto: any = {
      ...body,
      record_id: body.record_id,
      carpeta_id: body.carpeta_id,
      document_name: document_name,
      context: context, // asegurar objeto ya parseado
      // Asignar el archivo según el document_name
      ...(document_name === 'LOP' && { lop_pdf: fileBase64 }),
      ...(document_name === 'POLICY' && { policy_pdf: fileBase64 }),
      // Fallback para cualquier archivo
      file_data: fileBase64,
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

  // Nuevo endpoint batch para procesar múltiples documentos de una vez
  @Post('evaluate-claim-batch')
  @HttpCode(HttpStatus.OK)
  async evaluateClaimBatch(
    @Body() batchDto: EvaluateClaimBatchRequestDto
  ): Promise<EvaluateClaimResponseDto> {
    const startTime = Date.now();
    this.logger.log('📦 Received batch request');
    this.logger.log(`Record ID: ${batchDto.record_id}`);
    this.logger.log(`Carpeta ID: ${batchDto.carpeta_id}`);
    this.logger.log(`Documents: ${batchDto.documents?.length || 0}`);
    
    // Log documentos recibidos
    batchDto.documents?.forEach((doc, index) => {
      this.logger.log(`Document ${index + 1}: ${doc.document_name} (${doc.file_data?.length || 0} chars)`);
    });

    // Crear DTOs individuales para cada documento y procesarlos todos juntos
    const dto: EvaluateClaimRequestDto = {
      record_id: batchDto.record_id,
      carpeta_id: batchDto.carpeta_id,
      context: batchDto.context,
      // Pasar campos del contexto
      insured_name: batchDto.insured_name,
      insurance_company: batchDto.insurance_company,
      insured_address: batchDto.insured_address,
      insured_street: batchDto.insured_street,
      insured_city: batchDto.insured_city,
      insured_zip: batchDto.insured_zip,
      date_of_loss: batchDto.date_of_loss,
      policy_number: batchDto.policy_number,
      claim_number: batchDto.claim_number,
      type_of_job: batchDto.type_of_job,
    };

    // Procesar con lógica batch
    const result = await this.underwritingService.evaluateClaimBatch(dto, batchDto.documents);
    
    const processingTime = Date.now() - startTime;
    this.logger.log(`✅ Batch processing completed in ${processingTime}ms`);
    
    return result;
  }
}
