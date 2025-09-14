import { Controller, Get, Post, Param, Body, Logger } from '@nestjs/common';
import { EnhancedPdfProcessorService } from '../chunking/services/enhanced-pdf-processor.service';
import { ChunkStorageService } from '../chunking/services/chunk-storage.service';
import { SemanticChunkingService } from '../services/semantic-chunking.service';
import { VectorStorageService } from '../services/vector-storage.service';
import { ModernRagService } from '../services/modern-rag.service';

@Controller('api/debug/rag')
export class RagDebugController {
  private readonly logger = new Logger(RagDebugController.name);

  constructor(
    private readonly enhancedPdfProcessor: EnhancedPdfProcessorService,
    private readonly chunkStorage: ChunkStorageService,
    private readonly semanticChunking: SemanticChunkingService,
    private readonly vectorStorage: VectorStorageService,
    private readonly modernRag: ModernRagService,
  ) {}

  /**
   * Debug completo de una sesión específica
   */
  @Get('session/:sessionId')
  async debugSession(@Param('sessionId') sessionId: string) {
    this.logger.log(`🔍 [DEBUG] Starting comprehensive session debug: ${sessionId}`);
    
    const debugReport: any = {
      sessionId,
      timestamp: new Date(),
      steps: {},
      summary: {}
    };

    try {
      // 1. Verificar que la sesión existe
      this.logger.log(`📋 [DEBUG] Step 1: Checking session existence...`);
      const sessionExists = await this.chunkStorage.getSession(sessionId);
      debugReport.steps['1_session_check'] = {
        exists: !!sessionExists,
        status: sessionExists?.status,
        fileName: sessionExists?.fileName,
        fileSize: sessionExists?.fileSize,
        expiresAt: sessionExists?.expiresAt,
        createdAt: sessionExists?.createdAt
      };

      if (!sessionExists) {
        debugReport.summary.error = 'Session does not exist';
        return debugReport;
      }

      // 2. Verificar chunks procesados
      this.logger.log(`📦 [DEBUG] Step 2: Checking processed chunks...`);
      const chunks = await this.enhancedPdfProcessor.getProcessedChunks(sessionId);
      debugReport.steps['2_chunks_check'] = {
        totalChunks: chunks.length,
        chunkDetails: chunks.map(chunk => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          contentLength: chunk.content?.length || 0,
          contentPreview: chunk.content?.substring(0, 100) + '...',
          contentHash: chunk.contentHash,
          chunkSize: chunk.chunkSize
        }))
      };

      // 3. Intentar conversión semántica
      this.logger.log(`🧠 [DEBUG] Step 3: Testing semantic conversion...`);
      let semanticChunks = [];
      try {
        semanticChunks = await this.semanticChunking.convertChunksToSemantic(
          chunks, 
          sessionId, 
          sessionExists.fileName
        );
        debugReport.steps['3_semantic_conversion'] = {
          success: true,
          convertedChunks: semanticChunks.length,
          details: semanticChunks.map(sc => ({
            id: sc.id,
            sessionId: sc.sessionId,
            tokenCount: sc.tokenCount,
            characterCount: sc.characterCount,
            hasEmbedding: !!sc.embedding,
            embeddingDimensions: sc.embedding?.length || 0,
            semanticType: sc.metadata?.semanticType,
            importance: sc.metadata?.importance
          }))
        };
      } catch (error) {
        debugReport.steps['3_semantic_conversion'] = {
          success: false,
          error: error.message
        };
      }

      // 4. Verificar storage en vector database
      this.logger.log(`💾 [DEBUG] Step 4: Testing vector storage...`);
      try {
        if (semanticChunks.length > 0) {
          // No almacenar realmente, solo simular
          debugReport.steps['4_vector_storage_test'] = {
            wouldStore: semanticChunks.length,
            details: 'Simulation - not actually storing'
          };
        } else {
          debugReport.steps['4_vector_storage_test'] = {
            wouldStore: 0,
            error: 'No semantic chunks to store'
          };
        }

        // Verificar qué hay actualmente en la base de datos
        const vectorStats = this.vectorStorage.getStats();
        debugReport.steps['4_current_vector_stats'] = vectorStats;

      } catch (error) {
        debugReport.steps['4_vector_storage_test'] = {
          success: false,
          error: error.message
        };
      }

      // 5. Test de búsqueda RAG
      this.logger.log(`🔍 [DEBUG] Step 5: Testing RAG search...`);
      try {
        const testQuery = "find policy information";
        const ragResult = await this.modernRag.executeRAGPipeline(testQuery, sessionId);
        debugReport.steps['5_rag_search_test'] = {
          query: testQuery,
          answerLength: ragResult.answer?.length || 0,
          answerPreview: ragResult.answer?.substring(0, 200) + '...',
          sourcesCount: ragResult.sources?.length || 0,
          method: ragResult.method || 'unknown'
        };
      } catch (error) {
        debugReport.steps['5_rag_search_test'] = {
          success: false,
          error: error.message
        };
      }

      // 6. Resumen diagnóstico
      debugReport.summary = {
        sessionValid: !!sessionExists,
        chunksFound: chunks.length,
        semanticConversionSuccess: semanticChunks.length > 0,
        vectorStorageReady: true,
        ragSearchWorking: !!debugReport.steps['5_rag_search_test']?.answerLength,
        diagnosis: this.generateDiagnosis(debugReport)
      };

      this.logger.log(`✅ [DEBUG] Diagnostic complete for session ${sessionId}`);
      return debugReport;

    } catch (error) {
      this.logger.error(`❌ [DEBUG] Diagnostic failed: ${error.message}`);
      debugReport.summary.fatalError = error.message;
      return debugReport;
    }
  }

  /**
   * Test específico del race condition
   */
  @Post('test-race-condition')
  async testRaceCondition(@Body() body: { sessionId: string, waitTime?: number }) {
    const { sessionId, waitTime = 5000 } = body;
    
    this.logger.log(`⏱️ [DEBUG] Testing race condition with ${waitTime}ms wait for session ${sessionId}`);
    
    const result = {
      sessionId,
      waitTime,
      tests: [],
      conclusion: ''
    };

    // Test inmediato (actual comportamiento)
    const immediateTest = await this.testChunkAvailability(sessionId, 0);
    result.tests.push({ ...immediateTest, testName: 'immediate' });

    // Test con espera (comportamiento deseado)
    const delayedTest = await this.testChunkAvailability(sessionId, waitTime);
    result.tests.push({ ...delayedTest, testName: 'delayed' });

    // Conclusión
    if (immediateTest.chunksFound === 0 && delayedTest.chunksFound > 0) {
      result.conclusion = 'RACE CONDITION CONFIRMED: Chunks are processed after RAG execution';
    } else if (immediateTest.chunksFound > 0) {
      result.conclusion = 'NO RACE CONDITION: Chunks available immediately';
    } else {
      result.conclusion = 'UNKNOWN ISSUE: No chunks found even with delay';
    }

    return result;
  }

  private async testChunkAvailability(sessionId: string, waitTime: number) {
    if (waitTime > 0) {
      this.logger.log(`⏰ [DEBUG] Waiting ${waitTime}ms for chunks to be ready...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    try {
      const chunks = await this.enhancedPdfProcessor.getProcessedChunks(sessionId);
      return {
        success: true,
        chunksFound: chunks.length,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  private generateDiagnosis(debugReport: any): string[] {
    const issues = [];
    const steps = debugReport.steps;

    if (!steps['1_session_check']?.exists) {
      issues.push('Session does not exist');
    }

    if (steps['2_chunks_check']?.totalChunks === 0) {
      issues.push('No chunks found - possible race condition or processing failure');
    }

    if (!steps['3_semantic_conversion']?.success) {
      issues.push('Semantic conversion failed');
    }

    if (steps['5_rag_search_test']?.sourcesCount === 0) {
      issues.push('RAG search finds no sources - vector storage issue');
    }

    if (issues.length === 0) {
      issues.push('All systems appear to be working correctly');
    }

    return issues;
  }
}