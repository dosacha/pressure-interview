import {
  MAX_TOKENS_MESSAGE,
  NO_TEXT_BLOCK_PREFIX,
  RefusalError,
} from '../interview/llm/llm.service';
import { UpstreamError, toUpstreamError } from './session-errors';

describe('toUpstreamError', () => {
  it('RefusalError는 REFUSAL이고 category를 싣는다', () => {
    const e = toUpstreamError(new RefusalError('policy'));
    expect([e.reason, e.category]).toEqual(['REFUSAL', 'policy']);
  });
  it('LlmService가 던지는 max_tokens는 MAX_TOKENS', () => {
    expect(toUpstreamError(new Error(MAX_TOKENS_MESSAGE)).reason).toBe('MAX_TOKENS');
  });
  it('SyntaxError는 BAD_RESPONSE', () => {
    expect(toUpstreamError(new SyntaxError('x')).reason).toBe('BAD_RESPONSE');
  });
  it('LlmService가 text 블록이 없을 때 던지는 메시지는 BAD_RESPONSE', () => {
    const msg = `${NO_TEXT_BLOCK_PREFIX} (stop_reason: end_turn)`;
    expect(toUpstreamError(new Error(msg)).reason).toBe('BAD_RESPONSE');
  });
  it('그 밖의 Error는 API_ERROR', () => {
    expect(toUpstreamError(new Error('boom')).reason).toBe('API_ERROR');
  });
  it('이미 UpstreamError면 같은 객체', () => {
    const u = new UpstreamError('API_ERROR', null);
    expect(toUpstreamError(u)).toBe(u);
  });
  it('원래 오류의 메시지가 message에 없다', () => {
    expect(toUpstreamError(new SyntaxError('비밀-핵심-7731')).message).not.toContain('7731');
    expect(toUpstreamError(new Error('비밀-핵심-7731')).message).not.toContain('7731');
  });
});
