
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ChunkStorageService } from './chunk-storage.service';

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(private readonly chunkStorageService: ChunkStorageService) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async handleCron() {
    this.logger.log('Running scheduled cleanup of expired PDF chunking sessions...');
    const cleanedCount = await this.chunkStorageService.cleanupExpiredSessions();
    this.logger.log(`Cleanup complete. Removed ${cleanedCount} expired sessions.`);
  }
}
