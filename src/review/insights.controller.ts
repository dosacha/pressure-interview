import { Controller, Get } from '@nestjs/common';

import { MemoryService } from '../memory/memory.service';
import { ReviewService } from './review.service';

@Controller()
export class InsightsController {
  constructor(
    private readonly memory: MemoryService,
    private readonly reviews: ReviewService,
  ) {}

  @Get('memory/topics')
  async topics() {
    return { topics: await this.memory.pendingTopics(new Date()) };
  }

  @Get('stats')
  stats() {
    return this.reviews.stats();
  }
}
