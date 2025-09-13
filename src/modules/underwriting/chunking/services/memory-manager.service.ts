
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as v8 from 'v8';

interface MemoryStatus {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
}

@Injectable()
export class MemoryManagerService {
  private readonly logger = new Logger(MemoryManagerService.name);
  private readonly memoryLimitMB: number;
  private readonly enableMemoryMonitoring: boolean;

  constructor(private readonly configService: ConfigService) {
    this.enableMemoryMonitoring = this.configService.get<boolean>('ENABLE_MEMORY_MONITORING', true);
    this.memoryLimitMB = this.configService.get<number>('MEMORY_LIMIT_MB', 1536);
    if (this.enableMemoryMonitoring) {
      this.logger.log(`Memory monitoring enabled with a limit of ${this.memoryLimitMB}MB`);
    }
  }

  async monitorMemory(): Promise<MemoryStatus> {
    const heapStats = v8.getHeapStatistics();
    const memoryUsage = process.memoryUsage();
    return {
      heapUsed: heapStats.used_heap_size / 1024 / 1024,
      heapTotal: heapStats.total_heap_size / 1024 / 1024,
      rss: memoryUsage.rss / 1024 / 1024,
      external: memoryUsage.external / 1024 / 1024,
      arrayBuffers: memoryUsage.arrayBuffers / 1024 / 1024,
    };
  }

  async forceCleanup(): Promise<void> {
    if (global.gc) {
      this.logger.warn('Forcing garbage collection...');
      global.gc();
      this.logger.log('Garbage collection completed.');
    } else {
      this.logger.warn('Garbage collection is not exposed. Run with --expose-gc flag.');
    }
  }

  async pauseIfNeeded(): Promise<void> {
    if (!this.enableMemoryMonitoring) return;

    const { heapUsed } = await this.monitorMemory();
    const highWaterMark = this.memoryLimitMB * 0.9;
    const criticalWaterMark = this.memoryLimitMB * 0.8;

    if (heapUsed > highWaterMark) {
      this.logger.warn(`Memory usage is high (${heapUsed.toFixed(2)}MB). Pausing for 5 seconds.`);
      await this.forceCleanup();
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else if (heapUsed > criticalWaterMark) {
        this.logger.warn(`Memory usage is nearing critical level (${heapUsed.toFixed(2)}MB). Forcing cleanup.`);
        await this.forceCleanup();
    }
  }

  getOptimalChunkSize(fileSize: number): number {
    const fileSizeMB = fileSize / 1024 / 1024;
    const minChunkSize = this.configService.get<number>('MIN_CHUNK_SIZE', 2097152);
    const maxChunkSize = this.configService.get<number>('MAX_CHUNK_SIZE', 8388608);

    if (fileSizeMB <= 10) {
      return 0; // No chunking needed
    }
    if (fileSizeMB > 10 && fileSizeMB <= 25) {
      return minChunkSize; // 2MB
    }
    if (fileSizeMB > 25 && fileSizeMB <= 50) {
      return 5 * 1024 * 1024; // 5MB
    }
    return maxChunkSize; // 8MB
  }

  getProcessingConfig(fileSize: number): { chunkSize: number; maxParallel: number; memoryLimit: number; useStreaming: boolean; enableSwap: boolean; } {
    const fileSizeMB = fileSize / 1024 / 1024;
    let config = {
        chunkSize: this.getOptimalChunkSize(fileSize),
        maxParallel: this.configService.get<number>('MAX_PARALLEL_CHUNKS', 4),
        memoryLimit: this.memoryLimitMB,
        useStreaming: false,
        enableSwap: false,
    };

    if (fileSizeMB <= 10) {
        config.maxParallel = 1;
        config.useStreaming = false;
    } else if (fileSizeMB <= 25) {
        config.maxParallel = 4;
        config.useStreaming = true;
    } else if (fileSizeMB <= 50) {
        config.maxParallel = 2;
        config.useStreaming = true;
    } else { // > 50MB
        config.maxParallel = 1;
        config.useStreaming = true;
        config.enableSwap = true; // Suggests swapping if memory pressure is extreme
    }
    return config;
  }
}
