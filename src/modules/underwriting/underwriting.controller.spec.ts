import { Test, TestingModule } from '@nestjs/testing';
import { UnderwritingController } from './underwriting.controller';
import { UnderwritingService } from './underwriting.service';
import { EnhancedPdfProcessorService } from './chunking/services/enhanced-pdf-processor.service';
import { ConfigService } from '@nestjs/config';

describe('UnderwritingController - Large File Routing', () => {
  let controller: UnderwritingController;
  let underwritingService: {
    evaluateClaim: jest.Mock;
    processLargeFileSynchronously: jest.Mock;
    getVariableMapping: jest.Mock;
  };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    underwritingService = {
      evaluateClaim: jest.fn(),
      processLargeFileSynchronously: jest.fn(),
      getVariableMapping: jest.fn().mockReturnValue({}),
    } as any;

    configService = {
      get: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UnderwritingController],
      providers: [
        { provide: UnderwritingService, useValue: underwritingService },
        { provide: EnhancedPdfProcessorService, useValue: {} },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<UnderwritingController>(UnderwritingController);
  });

  it('routes JSON base64 > threshold to processLargeFileSynchronously', async () => {
    // Arrange: set a tiny threshold so our small base64 exceeds it
  configService.get.mockImplementation((key: string) => (key === 'LARGE_FILE_THRESHOLD_MB' ? 1 : undefined));

    const body = {
      document_name: 'POLICY',
      file_data: Buffer.from('hello world').toString('base64'), // ~8 bytes after base64 decoding
      context: { insured_name: 'John Doe' },
    };

    const expectedResponse = {
      record_id: 'rec-1',
      status: 'success',
      results: {},
      summary: { total_documents: 1, processed_documents: 1, total_fields: 1, answered_fields: 1 },
      processed_at: new Date(),
    } as any;

    underwritingService.processLargeFileSynchronously.mockResolvedValue(expectedResponse);

    // Act
    const res = await controller.evaluateClaim(body as any, {} as any);

    // Assert
    expect(underwritingService.processLargeFileSynchronously).toHaveBeenCalledTimes(1);
    const [pseudoFile, passthroughBody] = underwritingService.processLargeFileSynchronously.mock.calls[0];
    expect(pseudoFile.originalname).toBe('POLICY.pdf');
    expect(pseudoFile.mimetype).toBe('application/pdf');
    expect(Buffer.isBuffer(pseudoFile.buffer)).toBe(true);
    expect(passthroughBody.document_name).toBe('POLICY');
    expect(res).toBe(expectedResponse);
  });

  it('uses normal evaluateClaim when JSON base64 <= threshold', async () => {
    // Arrange: set a big threshold so our base64 is under it
  configService.get.mockImplementation((key: string) => (key === 'LARGE_FILE_THRESHOLD_MB' ? 10 : undefined));

    const body = {
      document_name: 'LOP',
      file_data: Buffer.from('small').toString('base64'),
      context: { insured_name: 'Alice' },
    };

    const expectedResponse = { status: 'success', results: {} } as any;
    underwritingService.evaluateClaim.mockResolvedValue(expectedResponse);

    // Act
    const res = await controller.evaluateClaim(body as any, {} as any);

    // Assert
    expect(underwritingService.processLargeFileSynchronously).not.toHaveBeenCalled();
    expect(underwritingService.evaluateClaim).toHaveBeenCalledTimes(1);
    expect(res).toBe(expectedResponse);
  });

  it('routes multipart file > threshold to processLargeFileSynchronously', async () => {
    // Arrange: set threshold to 10 bytes
  configService.get.mockImplementation((key: string) => (key === 'LARGE_FILE_THRESHOLD_MB' ? 10 : undefined));

    const fileBuffer = Buffer.from('this is a big-ish file');
    const files: any[] = [
      {
        originalname: 'INVOICES.pdf',
        size: fileBuffer.length, // > 10
        buffer: fileBuffer,
        mimetype: 'application/pdf',
      },
    ];

    const body: any = { document_name: 'INVOICES', context: { insurance_company: 'Acme' } };

    const expectedResponse = { status: 'success', results: {} } as any;
    underwritingService.processLargeFileSynchronously.mockResolvedValue(expectedResponse);

    // Act
    const res = await controller.evaluateClaimMultipart(files as any, body);

    // Assert
    expect(underwritingService.processLargeFileSynchronously).toHaveBeenCalledTimes(1);
    expect(res).toBe(expectedResponse);
  });
});
