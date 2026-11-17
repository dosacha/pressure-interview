import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';

import { parseAnswerInput, parseId, parseStartInput } from './interview-input';
import { InterviewService } from './interview.service';

@Controller('interviews')
export class InterviewController {
  constructor(private readonly interviews: InterviewService) {}

  @Post()
  start(@Body() body: unknown) {
    return this.interviews.start(parseStartInput(body));
  }

  @Get()
  list() {
    return this.interviews.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.interviews.getView(parseId(id, 'id'));
  }

  @Post(':id/answers')
  @HttpCode(200)
  answer(@Param('id') id: string, @Body() body: unknown) {
    const sessionId = parseId(id, 'id');
    return this.interviews.submitAnswer(sessionId, parseAnswerInput(body));
  }

  @Post(':id/advance')
  @HttpCode(200)
  advance(@Param('id') id: string) {
    return this.interviews.advance(parseId(id, 'id'));
  }

  @Post(':id/finish')
  @HttpCode(200)
  finish(@Param('id') id: string) {
    return this.interviews.finish(parseId(id, 'id'));
  }
}
