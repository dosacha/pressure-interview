import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';

import { parseId } from '../session/interview-input';
import { parseTurnPatch } from './review-input';
import { ReviewService } from './review.service';

@Controller('interviews')
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Post(':id/review')
  @HttpCode(202)
  async start(@Param('id') id: string) {
    const sessionId = parseId(id, 'id');
    await this.reviews.start(sessionId);
    return { status: (await this.reviews.getView(sessionId)).status };
  }

  @Get(':id/review')
  get(@Param('id') id: string) {
    return this.reviews.getView(parseId(id, 'id'));
  }

  @Patch(':id/turns/:turnId')
  update(@Param('id') id: string, @Param('turnId') turnId: string, @Body() body: unknown) {
    const sessionId = parseId(id, 'id');
    const turn = parseId(turnId, 'turnId');
    return this.reviews.updateTurn(sessionId, turn, parseTurnPatch(body));
  }
}
