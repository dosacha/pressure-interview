// 서버판 src/interview/calls/job-role.call.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
import { axisName, QUESTION_INTENTS, ROLES } from '../catalog.mjs';
                                                  
                                                      

const JOB_ROLES              = ['dba', 'security', 'architect'];

export const JOB_ROLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role'],
  properties: {
    role: { type: 'string', enum: JOB_ROLES, description: '고른 직무 id' },
  },
};

export function buildJobRolePrompt(topic        )                                   {
  const roles = JOB_ROLES.map((id) => {
    const r = ROLES[id];
    return [
      `- ${id} ${r.name}`,
      `  - 주로 바꾸는 가정 축: ${r.axes.map(axisName).join(', ')}`,
      `  - 주로 확인하는 질문 의도: ${r.intents.map((i) => `${i} ${QUESTION_INTENTS[i]}`).join(', ')}`,
    ].join('\n');
  }).join('\n');

  const system = `기술 압박 면접을 시작하기 전에 패널의 직무형 면접관 한 명의 직무를 고른다. 이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구이고, 지원자가 고른 주제 하나로 면접이 진행된다.

직무는 그 면접관이 주로 바꾸는 가정 축과 주로 확인하는 질문 의도를 정한다. 주제와 맞지 않는 직무를 고르면 그 면접관의 가정 변경 질문이 주제에서 멀어져, 지원자가 주제 기술의 장단점을 다시 생각하는 연습이 되지 않는다. 그래서 주제의 장단점을 가장 많이 흔들 수 있는 축을 가진 직무 하나를 고른다.

직무는 아래 셋 가운데 하나다.

${roles}`;

  return { system, user: `주제: ${topic}` };
}

export async function pickJobRole(
  llm         ,
  topic        ,
)                                                            {
  const { data, usage } = await llm.callJson                     ({
    role: 'analyze',
    ...buildJobRolePrompt(topic),
    schema: JOB_ROLE_SCHEMA,
  });
  return { data, usage };
}
