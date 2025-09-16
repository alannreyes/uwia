
import { Controller, Post, Get, Body, Param, Query, HttpCode, HttpStatus, Logger, Req, UseInterceptors, UploadedFile, UploadedFiles } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { Express } from 'express';
import { UnderwritingService } from './underwriting.service';
import { EvaluateClaimRequestDto } from './dto/evaluate-claim-request.dto';
import { EvaluateClaimResponseDto } from './dto/evaluate-claim-response.dto';
import { EvaluateClaimBatchRequestDto } from './dto/evaluate-claim-batch-request.dto';
import { EnhancedPdfProcessorService } from './chunking/services/enhanced-pdf-processor.service';
import { ConfigService } from '@nestjs/config';
import { ProcessingOrchestratorService } from './orchestration/processing-orchestrator.service';


@Controller('underwriting')
export class UnderwritingController {
  private readonly logger = new Logger(UnderwritingController.name);
  
  constructor(
    private readonly underwritingService: UnderwritingService,
    private readonly enhancedPdfProcessorService: EnhancedPdfProcessorService,
    private readonly configService: ConfigService,
    private readonly processingOrchestratorService: ProcessingOrchestratorService,
  ) {}

  @Post('evaluate-claim')
  @HttpCode(HttpStatus.OK)
  async evaluateClaim(
    @Body() body: any,
    @Req() req: any
  ): Promise<EvaluateClaimResponseDto> {
    this.logger.log('🔍 Request received with fields:');
    const cleanBody = { ...body };
    // Remove ALL large content fields from logging
    if (cleanBody.file_data) cleanBody.file_data = '[BASE64_REMOVED]';
    if (cleanBody.lop_pdf) cleanBody.lop_pdf = '[BASE64_REMOVED]';
    if (cleanBody.policy_pdf) cleanBody.policy_pdf = '[BASE64_REMOVED]';
    if (cleanBody.documents) cleanBody.documents = '[BATCH_DOCS_REMOVED]';
    if (cleanBody.context && typeof cleanBody.context === 'object' && JSON.stringify(cleanBody.context).length > 500) {
      cleanBody.context = '[LARGE_CONTEXT_REMOVED]';
    }
    // Only log field names, not content
    this.logger.log(`📋 Fields: ${Object.keys(cleanBody).join(', ')}`);
    this.logger.log(`📄 Document: ${cleanBody.document_name || 'unknown'}`);
    this.logger.log(`🆔 Record: ${cleanBody.record_id || 'unknown'}`);

    // Basic validation only - file data debugging removed to clean logs

    // If JSON route carries base64 and it's large, route to large-file flow
    try {
      const largeFileThreshold = this.configService.get<number>('LARGE_FILE_THRESHOLD_BYTES') || 10485760; // 10MB default
      const documentName = body.document_name || 'DOCUMENT';
      const base64 = body.file_data || body.lop_pdf || body.policy_pdf;
      if (typeof base64 === 'string' && base64.length > 0) {
        const padding = (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
        const estimatedBytes = Math.floor(base64.length * 3 / 4) - padding;
        this.logger.log(`🔍 [JSON-FILE-DEBUG] Estimated base64 size: ${estimatedBytes} bytes (${(estimatedBytes/1024/1024).toFixed(2)} MB)`);
        this.logger.log(`🔍 [JSON-FILE-DEBUG] Threshold: ${largeFileThreshold} bytes (${(largeFileThreshold/1024/1024).toFixed(2)} MB)`);
        if (estimatedBytes > largeFileThreshold) {
          this.logger.log(`🐘 [LARGE-FILE-ROUTE:JSON] Routing to processLargeFileSynchronously (base64)`);
          const buffer = Buffer.from(base64, 'base64');
          const pseudoFile: any = {
            originalname: `${documentName}.pdf`,
            size: estimatedBytes,
            buffer,
            mimetype: 'application/pdf'
          };
          // Ensure context is parsed for the service
          let preCtx = body.context;
          if (typeof preCtx === 'string') { try { preCtx = JSON.parse(preCtx); } catch {} }
          const passthroughBody = { ...body, document_name: documentName, context: preCtx };
          return await this.underwritingService.processLargeFileSynchronously(pseudoFile, passthroughBody);
        }
      }
    } catch (jsonRouteErr) {
      this.logger.warn(`⚠️ [JSON-FILE-ROUTE] Large-file routing check failed: ${jsonRouteErr.message}`);
    }
    
    // Pre-compute variables at ingress
    let preContext = body.context;
    if (typeof preContext === 'string') {
      try { preContext = JSON.parse(preContext); } catch {}
    }
    const _variables = this.underwritingService.getVariableMapping(body, preContext);
    const dto = { ...(body as EvaluateClaimRequestDto), _variables } as any;
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
    this.logger.log(`📋 Body fields: ${Object.keys(body).join(', ')}`);
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
  const largeFileThreshold = this.configService.get<number>('LARGE_FILE_THRESHOLD_BYTES') || 10485760;

      // 🚨 CRITICAL DEBUG LOGGING
      this.logger.log(`🔍 [FILE-DEBUG] File: ${uploadedFile.originalname}`);
      this.logger.log(`🔍 [FILE-DEBUG] Size: ${uploadedFile.size} bytes (${(uploadedFile.size / 1024 / 1024).toFixed(2)} MB)`);
      this.logger.log(`🔍 [FILE-DEBUG] Threshold: ${largeFileThreshold} bytes (${(largeFileThreshold / 1024 / 1024).toFixed(2)} MB)`);
      this.logger.log(`🔍 [FILE-DEBUG] Is Large?: ${uploadedFile.size > largeFileThreshold}`);

      if (uploadedFile.size > largeFileThreshold) {
        this.logger.log(`🐘 [LARGE-FILE-ROUTE] Processing via processLargeFileSynchronously`);

        // Iniciar procesamiento síncrono para archivos grandes
        return this.underwritingService.processLargeFileSynchronously(
          uploadedFile,
          body,
        );
      }

      this.logger.log(`📄 [NORMAL-FILE-ROUTE] Processing via normal evaluateClaim flow`);

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
        this.logger.log(`File converted to base64 successfully`);
        
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
      carpeta_id: dto.carpeta_id,
      record_id: dto.record_id,
      document_name: dto.document_name,
      context: typeof dto.context,
      has_file_data: !!dto.file_data
    });

    // Pre-compute variables at ingress for multipart too
    const _variables = this.underwritingService.getVariableMapping(dto, dto.context);
    return this.underwritingService.evaluateClaim({ ...dto, _variables } as any);
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
      this.logger.log(`Document ${index + 1}: ${doc.document_name} (has file: ${!!doc.file_data})`);
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
