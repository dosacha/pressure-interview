import { checkNaming } from './naming';

describe('checkNaming', () => {
  it('언급하지 않은 해답 기술은 위반', () => {
    expect(
      checkNaming({ techs: [{ name: 'Kafka', role: 'solution' }], userMentioned: ['Redis'] }),
    ).toEqual({ ok: false, violations: ['Kafka'] });
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
});
