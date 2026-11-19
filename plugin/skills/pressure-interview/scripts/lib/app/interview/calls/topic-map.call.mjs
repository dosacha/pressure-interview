// 스킬이 만든 파일이다.
import { EngineError } from '../../../errors.mjs';
import { axisName, OWNABLE_AXES } from '../catalog.mjs';

export const TOPIC_MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['areas'],
  properties: {
    areas: {
      type: 'array',
      minItems: 4,
      maxItems: 8,
      description: '주제의 영역 4~8개',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'core', 'why', 'axis', 'angles'],
        properties: {
          id: { type: 'string', description: '영역 id. 영문 소문자와 밑줄, 지도 안에서 겹치지 않게' },
          name: { type: 'string', description: '영역 이름' },
          core: { type: 'boolean', description: '핵심 영역이면 true' },
          why: { type: 'string', description: '이 주제에서 왜 중요한가, 한 문장' },
          axis: { type: 'string', enum: OWNABLE_AXES, description: '그 영역에서 가정을 바꿀 때 주로 쓸 축' },
          angles: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            description: '허를 찌를 만한 가정의 방향, 한 문장씩',
            items: { type: 'string' },
          },
        },
      },
    },
  },
};

export function buildTopicMapPrompt(topic) {
  const axes = OWNABLE_AXES.map((id) => `- ${id} ${axisName(id)}`).join('\n');
  const system = `기술 압박 면접을 시작하기 전에 지원자가 고른 주제를 영역으로 나눈 주제 지도를 만든다. 이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구이고, 면접관은 이 지도를 보고 영역마다 질문을 열며 주제를 넓게 훑는다.

## 영역

주제를 4개 이상 8개 이하의 영역으로 나눈다. 영역마다 아래를 쓴다.
- id: 영문 소문자와 밑줄로 쓴 짧은 식별자. 지도 안에서 겹치면 안 된다.
- name: 영역 이름.
- core: 핵심 영역이면 true, 주변 영역이면 false.
- why: 이 주제에서 이 영역이 왜 중요한가, 한 문장.
- axis: 그 영역에서 가정을 바꿔 질문을 열 때 주로 쓸 축. 아래 목록의 id 하나.
- angles: 허를 찌를 만한 가정의 방향 1개 이상 3개 이하. 한 문장씩 쓴다.

## 핵심 영역

핵심 영역은 "이 주제를 실무에서 쓰는 사람이라면 반드시 알아야 할 것"이다. 핵심 영역은 2개 이상 6개 이하로 정한다. 핵심 영역을 다 물어야 지원자가 이 주제를 아는지 볼 수 있으므로, 있으면 좋은 것이나 깊이 파는 사람만 아는 것은 주변 영역으로 둔다.

## 축

axis는 아래 가운데 하나다.

${axes}`;

  return { system, user: `주제: ${topic}` };
}

// 모델이 지킨다고 믿지 않고 코드로도 확인한다: 핵심 영역 수와 id 중복.
function checkTopicMap(data) {
  const ids = data.areas.map((a) => a.id);
  const coreCount = data.areas.filter((a) => a.core).length;
  if (coreCount < 2 || coreCount > 6) {
    throw new EngineError('schema_failed', `주제 지도의 핵심 영역이 ${coreCount}개다(2~6개여야 한다)`);
  }
  if (new Set(ids).size !== ids.length) {
    throw new EngineError('schema_failed', '주제 지도의 영역 id가 겹친다');
  }
}

export async function generateTopicMap(llm, topic) {
  const { data, usage } = await llm.callJson({
    role: 'analyze',
    ...buildTopicMapPrompt(topic),
    schema: TOPIC_MAP_SCHEMA,
  });
  checkTopicMap(data);
  return { data, usage };
}
