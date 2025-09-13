
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, FindOptionsWhere, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { PdfProcessingSession, ProcessingStatus } from '../entities/pdf-processing-session.entity';
import { PdfChunk } from '../entities/pdf-chunk.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ChunkStorageService {
  private readonly logger = new Logger(ChunkStorageService.name);

  constructor(
    @InjectRepository(PdfProcessingSession)
    private readonly sessionRepository: Repository<PdfProcessingSession>,
    @InjectRepository(PdfChunk)
    private readonly chunkRepository: Repository<PdfChunk>,
    private readonly configService: ConfigService,
  ) {}

  async createSession(fileName: string, fileSize: number): Promise<PdfProcessingSession> {
    const ttl = this.configService.get<number>('CHUNK_SESSION_TTL', 86400);
    const session = this.sessionRepository.create({
      id: uuidv4(),
      fileName,
      fileSize,
      status: 'processing',
      expiresAt: new Date(Date.now() + ttl * 1000),
    });
    await this.sessionRepository.save(session);
    this.logger.log(`Created new processing session ${session.id} for file ${fileName}`);
    return session;
  }

  async getSession(sessionId: string): Promise<PdfProcessingSession | null> {
    return this.sessionRepository.findOne({ where: { id: sessionId } });
  }

  async updateSessionStatus(sessionId: string, status: ProcessingStatus): Promise<void> {
    await this.sessionRepository.update(sessionId, { status });
    this.logger.log(`Updated session ${sessionId} status to ${status}`);
  }
  
  async updateSession(sessionId: string, data: Partial<PdfProcessingSession>): Promise<void> {
    await this.sessionRepository.update(sessionId, data);
  }

  async storeChunk(
    sessionId: string,
    chunkIndex: number,
    content: string,
    pageStart?: number,
    pageEnd?: number,
  ): Promise<PdfChunk> {
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const chunkSize = Buffer.byteLength(content, 'utf-8');
    const chunkId = `${sessionId}-${chunkIndex}`;

    const chunk = this.chunkRepository.create({
      id: chunkId,
      sessionId,
      chunkIndex,
      content,
      contentHash,
      chunkSize,
      pageStart,
      pageEnd,
    });

    await this.chunkRepository.save(chunk);
    return chunk;
  }

  async getChunks(sessionId: string): Promise<PdfChunk[]> {
    return this.chunkRepository.find({
      where: { sessionId },
      order: { chunkIndex: 'ASC' },
    });
  }

  async findChunksByKeywords(sessionId: string, keywords: string[]): Promise<PdfChunk[]> {
    if (keywords.length === 0) return [];
  
    const query = this.chunkRepository.createQueryBuilder('chunk')
      .where('chunk.sessionId = :sessionId', { sessionId })
      .andWhere('MATCH(chunk.content) AGAINST (:query IN BOOLEAN MODE)', { 
        query: keywords.map(k => `+${k}`).join(' ') 
      });
  
    return query.getMany();
  }

  async cleanupExpiredSessions(): Promise<number> {
    const now = new Date();
    const expiredSessions = await this.sessionRepository.find({
      where: { expiresAt: LessThan(now) },
    });

    if (expiredSessions.length === 0) {
      return 0;
    }

    const sessionIds = expiredSessions.map(s => s.id);
    this.logger.log(`Found ${sessionIds.length} expired sessions to clean up.`);

    // Chunks are deleted by CASCADE constraint
    const result = await this.sessionRepository.delete({ id: In(sessionIds) });

    this.logger.log(`Cleaned up ${result.affected} sessions and their associated chunks.`);
    return result.affected || 0;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) {
      await this.sessionRepository.remove(session);
      this.logger.log(`Manually deleted session ${sessionId} and its chunks.`);
    }
  }
}
