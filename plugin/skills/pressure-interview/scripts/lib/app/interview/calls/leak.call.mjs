// 생성된 파일이다. 손으로 고치지 않는다. 원본: src/interview/calls/leak.call.ts @ aeae0dd, 도구: tools/port-app-src.mjs
                                                  
                                                        
import { REQUIRED_RULES } from './question.call.mjs';

export const LEAK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['techs'],
  properties: {
    techs: {
      type: 'array',
      description: '질문 문장에 나온 기술 이름과 역할. 없으면 빈 배열',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'role'],
        properties: {
          name: { type: 'string', description: '기술 이름' },
          role: {
            type: 'string',
            enum: ['premise', 'solution', 'user'],
            description: '질문 안에서 그 기술이 하는 역할',
          },
        },
      },
    },
  },
};

const OX_EXAMPLES = REQUIRED_RULES.split('\n')
  .filter((line) => /^- [OX]: /.test(line))
  .join('\n');

function buildLeakPrompt(input                                                   )   
                 
               
  {
  const system = `기술 압박 면접의 질문 문장에 나온 기술 이름을 모두 찾아 역할을 하나씩 붙인다. 코드는 이 결과로 면접관이 지원자가 말하지 않은 해답 기술을 먼저 꺼냈는지 판정한다. 해답을 흘리면 지원자가 스스로 대안을 떠올리는 연습이 사라지기 때문이다.

기술 이름은 제품, 엔진, 프레임워크, 프로토콜처럼 이름이 붙은 기술이다. 캐시, 락, 인덱스 같은 일반 개념어는 넣지 않는다.

역할은 그 기술이 질문 안에서 하는 일로 정한다.
- user: 지원자가 말한 기술 목록에 있는 기술. 목록에 있으면 질문 안에서 하는 일과 상관없이 user다. 질문에 다른 표기로 나와도 name은 목록의 표기 그대로 적는다. 코드가 대소문자와 공백만 맞춰 목록과 비교하기 때문이다.
- premise: 가정을 바꾼 질문에서 그 가정을 세우기 위해 꺼낸 기술. 가정이 바뀐 기술 A와, A와 비교하려고 세운 기술 B가 모두 premise다. 지원자의 문제를 풀려고 꺼낸 것이 아니라 바뀐 가정과 그 비교를 세우려고 꺼냈다. 가정을 바꾸지 않는 문장에서 비교 대상으로만 세운 기술은 premise가 아니다.
- solution: 지원자의 문제를 풀 방법이나 대안으로 제시된 기술. 목록에 없고 premise도 아닌 기술은 solution이다. 다만 목록에 있는 기술의 기능, 구성 요소, 명령은 아래 기준을 따른다.

목록에 있는 기술 A의 기능, 구성 요소, 명령은 질문 안에서 하는 일로 가른다. A를 캐묻는 대상으로 나왔으면 나열하지 않는다. 지원자가 말한 A를 얼마나 아는지 묻는 것이라 해답을 흘리지 않기 때문이다. 지원자의 문제를 풀 방법이나 대안으로 제시됐으면 solution으로 나열한다. 지원자가 A의 기능 하나로 문제를 풀었는데 질문이 A의 다른 기능 B를 대안으로 꺼내면, B는 지원자가 말하지 않은 해답이기 때문이다.

판단 기준으로 다음 예시를 쓴다. X는 해답을 흘린 질문이고, O는 흘리지 않은 질문이다.
${OX_EXAMPLES}`;

  const mentioned = input.userMentioned.length > 0 ? input.userMentioned.join(', ') : '없음';
  const user = `지원자가 말한 기술: ${mentioned}\n\n질문 문장:\n${input.questionText}`;
  return { system, user };
}

export async function detectTechs(
  llm         ,
  input                                                   ,
)                                                                 {
  const { data, usage } = await llm.callJson                          ({
    role: 'leak',
    ...buildLeakPrompt(input),
    schema: LEAK_SCHEMA,
  });
  return { data, usage };
}
