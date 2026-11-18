// 생성된 파일이다. 손으로 고치지 않는다. 원본: src/interview/naming.spec.ts @ aeae0dd, 도구: tools/port-app-src.mjs
import { describe, it, expect, jest } from '../../jest-shim.mjs';
import { checkNaming } from '../../../skills/pressure-interview/scripts/lib/app/interview/naming.mjs';

describe('checkNaming', () => {
  it('언급하지 않은 해답 기술은 위반', () => {
    expect(
      checkNaming({ techs: [{ name: 'Kafka', role: 'solution' }], userMentioned: ['Redis'] }),
    ).toEqual({ ok: false, violations: ['Kafka'], avoided: [] });
  });
  it('내가 말한 기술은 대소문자·공백이 달라도 허용', () => {
    expect(
      checkNaming({ techs: [{ name: ' kafka', role: 'solution' }], userMentioned: ['Kafka '] }).ok,
    ).toBe(true);
  });
  it('가정 변경의 전제는 안 써 본 기술이어도 허용', () => {
    expect(
      checkNaming({ techs: [{ name: 'PostgreSQL', role: 'premise' }], userMentioned: [] }).ok,
    ).toBe(true);
  });
  it('user로 표시됐지만 실제로 언급하지 않은 기술은 위반', () => {
    expect(
      checkNaming({ techs: [{ name: 'RabbitMQ', role: 'user' }], userMentioned: ['Redis'] }).ok,
    ).toBe(false);
  });
  it('모른다고 한 기술은 전제여도 위반이고 avoided에 든다', () => {
    expect(
      checkNaming({
        techs: [{ name: 'memcached ', role: 'premise' }],
        userMentioned: ['Redis'],
        avoid: ['Memcached'],
      }),
    ).toEqual({ ok: false, violations: ['memcached'], avoided: ['memcached'] });
  });
  it('지원자가 말한 기술이어도 avoid에 있으면 위반이다', () => {
    expect(
      checkNaming({
        techs: [{ name: 'Lua', role: 'user' }],
        userMentioned: ['Redis', 'Lua'],
        avoid: [' lua'],
      }),
    ).toEqual({ ok: false, violations: ['Lua'], avoided: ['Lua'] });
  });
  it('avoid가 없으면 avoided는 빈 배열이다', () => {
    expect(
      checkNaming({ techs: [{ name: 'RabbitMQ', role: 'user' }], userMentioned: ['Redis'] }),
    ).toEqual({ ok: false, violations: ['RabbitMQ'], avoided: [] });
  });
});
