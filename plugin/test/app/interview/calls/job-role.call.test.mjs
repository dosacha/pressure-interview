// 서버판 src/interview/calls/job-role.call.spec.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
import { describe, it, expect, jest } from '../../../jest-shim.mjs';
import { ROLES } from '../../../../skills/pressure-interview/scripts/lib/app/interview/catalog.mjs';
import { JOB_ROLE_SCHEMA, buildJobRolePrompt, pickJobRole } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/job-role.call.mjs';

describe('job-role.call', () => {
  it('스키마의 enum이 직무형 역할 셋과 같다', () => {
    const jobs = Object.entries(ROLES)
      .filter(([, r]) => r.type === 'job')
      .map(([id]) => id);
    expect(JOB_ROLE_SCHEMA.properties.role.enum).toEqual(jobs);
  });
  it('세 직무의 축 이름을 프롬프트에 싣는다', () => {
    const { system, user } = buildJobRolePrompt('Redis');
    for (const name of ['영속성·전달 보장', '공격', '기술 대체']) expect(system).toContain(name);
    expect(user).toContain('Redis');
  });
  it('analyze 역할과 스키마로 호출한다', async () => {
    const callJson = jest.fn().mockResolvedValue({
      data: { role: 'dba' },
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'm',
    });
    expect((await pickJobRole({ callJson }, 'Redis')).data.role).toBe('dba');
    expect(callJson).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'analyze', schema: JOB_ROLE_SCHEMA }),
    );
  });
});
