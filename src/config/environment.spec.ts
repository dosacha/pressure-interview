import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  it('아무 값도 없으면 기본값으로 채운다', () => {
    expect(validateEnvironment({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3110,
      DB_HOST: '127.0.0.1',
      DB_PORT: 5436,
      DB_USERNAME: 'interview',
      DB_PASSWORD: 'interview_local',
      DB_DATABASE: 'interview',
    });
  });
  it('빈 문자열은 없는 값으로 본다', () => {
    expect(validateEnvironment({ PORT: '' }).PORT).toBe(3110);
  });
  it('모르는 키도 결과에 남는다(.env의 나머지 값이 process.env로 가야 한다)', () => {
    expect(validateEnvironment({ ENGINE_MAX_CONSECUTIVE: '3' }).ENGINE_MAX_CONSECUTIVE).toBe('3');
  });
  it('틀린 값은 변수 이름으로 알리고 값은 메시지에 넣지 않는다', () => {
    const run = () => validateEnvironment({ DB_PORT: 'not-a-port-9731' });
    expect(run).toThrow(/DB_PORT/);
    expect(run).not.toThrow(/9731/);
  });
  it('PORT가 1~65535의 정수가 아니면 던진다', () => {
    expect(() => validateEnvironment({ PORT: '0' })).toThrow(/PORT/);
  });
  it('NODE_ENV가 목록 밖이면 던진다', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
