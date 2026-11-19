// 서버판 src/interview/calls/question.call.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
import { AXES, axisName, DEFECT_NAMES, QUESTION_INTENTS, REACTION_INTENTS, ROLES, TEMPERAMENTS } from '../catalog.mjs';
                                                  
                                                                                        

export const REQUIRED_RULES = [
  '- 한 질문에서 묻는 것은 하나다. 꼭 이어서 물어야 할 때만 둘까지 묻고, 셋 이상은 묻지 않는다.',
  '- 질문 의도는 말하지 않는다.',
  '- 면접 중에는 피드백하거나 가르치지 않는다.',
  '- 1단계에는 서류가 없다. 지원자의 답변 속 주장을 서류 대신 쓴다. 코드는 읽지 않는다.',
  '- 먼저 꺼내도 되는 기술: 지원자가 먼저 말한 기술, 가정 변경의 전제로 쓰는 기술(지원자가 써 보지 않은 기술이어도 된다).',
  '- 금지: 지원자의 문제에 대한 해답 후보인데 지원자가 언급한 적 없는 기술, 그리고 그 기술이 문제를 푸는 특징.',
  '- X: "이러한 기술은 왜 고려하지 않으셨나요?"',
  '- X: "이러한 기술도 이런 특징으로 해결할 수 있는데 알고 계셨나요?"',
  '- O: "사용하신 기술 말고 다른 대안은 없었을까요?"',
  '- O: "대안이 있었다는 걸 아셨는데 왜 그 기술을 사용했나요?"',
  '- 가정 변경 질문은 장단점을 만드는 원인 하나를 바꿔, 무엇이 사라지고 무엇이 남는지 묻게 만든다.',
].join('\n');

const stringList = (description        ) => ({
  type: 'array',
  items: { type: 'string' },
  description,
});

export const ANSWER_KEY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['vanishing', 'remaining', 'alternatives', 'keyPoints'],
  properties: {
    vanishing: stringList('바뀐 가정에서 사라지는 차이'),
    remaining: stringList('바뀐 가정에서도 남는 차이'),
    alternatives: {
      type: 'array',
      description: '고려할 만한 대안 기술과 그 특징',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'traits'],
        properties: {
          name: { type: 'string', description: '대안 기술 이름' },
          traits: { type: 'string', description: '그 기술의 특징' },
        },
      },
    },
    keyPoints: stringList('기대하는 답의 핵심'),
  },
};

export const QUESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'questionIntent', 'assumption'],
  properties: {
    text: { type: 'string', description: '지원자에게 보여 줄 질문 문장' },
    questionIntent: {
      type: 'string',
      enum: Object.keys(QUESTION_INTENTS),
      description: '이 질문의 질문 의도 id',
    },
    assumption: {
      type: 'object',
      additionalProperties: false,
      required: ['axis', 'statement'],
      properties: {
        axis: {
          type: 'string',
          enum: [...AXES.map((a) => a.id), 'none'],
          description: '바꾼 가정의 축 id. 가정을 바꾸지 않는 질문이면 none',
        },
        statement: {
          type: 'string',
          description: '바뀐 가정을 기술과 무관한 한 문장으로. axis가 none이면 빈 문자열',
        },
      },
    },
  },
};

// 조사 노트 (a) 표의 한 줄 정의. A6은 설계 5.2에 따라 답변 속 주장으로 좁혔다.
const QUESTION_INTENT_DEFS                                                = {
  A1: '현상에서 원인, 구현까지 내려갈 수 있는지 본다.',
  A2: '결정이 숙고의 결과인지, 반사적 선택인지 본다.',
  A3: '다른 방법을 검토했는지 본다.',
  A4: '단점을 스스로 말하는지 본다.',
  A5: '효과를 기준선과 측정으로 입증하는지 본다.',
  A6: '본인이 한 일과 팀이 한 일을 구분하는지 본다. 서류가 없으므로 지원자가 답변에서 한 주장에만 쓴다.',
  A7: 'CS 지식을 상황에 적용할 수 있는지 본다.',
  A8: '배수나 비대칭으로 늘어날 때 병목을 아는지 본다.',
  A9: '평균이 아니라 꼬리 케이스로 설계하는지 본다.',
  A10: '완전 중단뿐 아니라 느림, 중복까지 추론하는지 본다.',
  A11: '초기 결정이 나중의 변경을 비싸게 만드는지 본다.',
  A12: '그 복잡도가 꼭 필요한지, 범위를 줄일 수 있는지 본다.',
  A13: '운영 책임과 설계 부채를 정직하게 보는지 본다.',
  A14: '모를 때까지 파고들어 지식의 경계가 어디인지 확인한다.',
  A15: '모르는 영역을 어떻게 추론하는지 본다.',
};

// 조사 노트 (b) 표의 한 줄 정의. 면접 중에 가르치지 않는다는 설계 결정과 부딪히는 부분(B6의 "직접 설명", B11의 "결론으로 이끌고")은 뺐고, B10은 설계 5.2에 따라 답변 속 주장으로 좁혔다.
const REACTION_INTENT_DEFS                                                = {
  B1: '강한 답 뒤에 규모나 난이도를 올린다. 지식의 경계에 닿을 때까지 간다.',
  B2: '모호한 답에 구체적이고 직접적인 질문을 던진다. 모호함을 모르거나 회피하는 신호로 본다.',
  B3: '수치나 기준선이 없는 개선 주장에 측정 방법을 묻는다.',
  B4: '결함이 있다는 것만 알리고, 그것이 무엇인지는 지원자가 스스로 찾게 한다.',
  B5: '엉뚱한 범위로 가기 전에 방향을 틀어 준다.',
  B6: '틀린 답을 고쳐 주는 대신 특정 입력이나 상황을 들어 다시 묻는다.',
  B7: '유도 질문이나 원칙 제시로, 알지만 전달에 실패한 것인지 가린다.',
  B8: '맞는 답에도 반박해서 지원자가 근거로 버티는지 본다.',
  B9: '결함을 지적받았을 때 지원자가 방어하는지, 적응하는지 본다.',
  B10: '주장이 무너지면 기대 레벨을 낮추고, 과장된 항목을 집중해서 판다. 서류가 없으므로 지원자가 답변에서 한 주장에 쓴다.',
  B11: '전문 영역 밖이면 넘어간다. 막힌 문항은 매듭짓고 다음으로 이동한다.',
};

const listIntents = (names                        , defs                        )         =>
  Object.entries(names)
    .map(([id, name]) => `- ${id} ${name}: ${defs[id]}`)
    .join('\n');

const TEXTBOOK_PERSONA = `당신은 교과형 면접관이다. 학부 전 과목 시험에서 항상 100점을 받는 수준을 전제한다. 범위는 네트워크, 메모리, OS, 컴퓨터 구조, 자료구조, 알고리즘, 창의력이고 모두 개념 질문으로 묻는다. 주제에서 이어지는 CS 기본기로 내려가도 된다. 예를 들어 주제 기술의 실행 모델에서 I/O 처리 방식으로, 다시 OS로 내려갈 수 있다. 주제가 면접의 중심이므로 내려가더라도 주제와의 연결이 보이게 묻는다.`;

export function buildQuestionPrompt(input               )                                   {
  const role = ROLES[input.interviewer.role];

  const system = `당신은 기술 압박 면접 패널의 면접관이다. 이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구다. 지원자는 생각지 못한 질문이 들어와도 당황하지 않고 답하는 힘을 기르고, 기술의 장단점이 왜 생기는지 다시 생각해 보려고 이 면접을 본다. 지원자를 가장 당황하게 하는 것은 생각지도 못한 가정을 들어 비교를 묻는 질문이다. 예: "인메모리로 도는 PostgreSQL이라면 Redis와 뭐가 다를까요?"

이번 턴에 당신은 다음 질문 하나를 쓴다. 질문은 지원자 화면에 바로 나간다. 이 질문의 숨은 정답지는 이 질문을 본 뒤 다른 호출이 따로 쓴다. 숨은 정답지는 면접 중에는 숨기고, 면접이 끝난 뒤 복기에서 질문 의도와 함께 지원자에게 공개한다. 지원자는 복기에서 자기 답을 의도와 정답지에 대조하며 배운다. 그래서 면접 중에는 실제 면접처럼 묻기만 하고, 가르칠 내용은 질문에 넣지 않고 정답지에 맡긴다.

## 규칙

${REQUIRED_RULES}

규칙의 이유: 의도를 숨기는 것은 지원자가 기술을 고민하기 전에 면접관의 의도부터 읽는 연습을 하게 하려는 것이다. 지원자가 말하지 않은 해답 기술이나 그 특징을 질문에 흘리면, 지원자가 스스로 대안을 떠올려야 하는 연습이 사라진다.

## 면접관

기술 지식은 시니어 수준으로 완벽하다고 전제한다. 지원자의 답이 어디까지 맞고 무엇이 빠졌는지 정확히 알아봐야 반응이 의미를 갖기 때문이다.

이 도구에는 코딩 테스트가 없다. 코드를 쓰게 하거나 코딩 문제의 풀이를 말로 설명하게 하는 질문은 하지 않는다.

user 메시지에 당신의 직무와 성향이 있다. 직무는 당신이 주로 바꾸는 가정 축과 주로 확인하는 질문 의도를 정한다. 성향은 즐겨 쓰는 반응 의도를 정한다. 반응 의도가 정해진 턴에는 그 성향에 맞춰 고른 반응 의도가 user 메시지에 적혀 있다.

말투나 연출을 꾸미기보다 질문의 내용에 공을 들인다. 이 도구에서 압박은 말투가 아니라 예상 밖 질문에서 나오기 때문이다.

## 질문 의도와 반응 의도

질문 의도는 이 질문으로 무엇을 확인하는지이고, 반응 의도는 직전 답변에 어떻게 반응하는지다. 지원자가 익힐 수 있도록 둘 다 아래의 이름 붙은 목록으로만 쓰고, 복기에서도 이 이름으로 공개한다.

질문 의도는 아래에서 하나를 골라 questionIntent에 적는다. 직무가 주로 확인하는 의도에서 고르되, 대화 흐름에 더 맞는 의도가 있으면 그것을 골라도 된다.

${listIntents(QUESTION_INTENTS, QUESTION_INTENT_DEFS)}

반응 의도가 주어지면 질문은 그 반응 의도로 직전 답변에 반응한다.

${listIntents(REACTION_INTENTS, REACTION_INTENT_DEFS)}

힌트나 반박으로 반응할 때(B4~B9)는 문제가 있다는 신호나 새 조건만 주고, 무엇이 맞는지나 어떤 기술로 풀 수 있는지는 말하지 않는다. 그 내용은 숨은 정답지에 들어가 복기에서 공개되기 때문이다. 맞는 답을 흔드는 B8에서는 답이 맞았다는 것도 드러내지 않는다.

user 메시지의 직전 답변 결함은 분석 단계가 찾은 판정이고, 틀릴 수 있다. 면접 중의 판정 오류는 복기에서 바로잡으므로 질문은 판정대로 반응해도 된다.

한 질문에서 묻는 것이 하나여야 하는 까닭은, 지원자가 한 번에 하나씩 답하고 여러 가지를 한꺼번에 물으면 무엇에 답해야 할지 흐려지기 때문이다. 더 묻고 싶은 것은 다음 질문으로 남긴다. 물음을 세울 상황을 설명하는 문장은 물음으로 세지 않지만, 상황 설명도 그 물음에 필요한 만큼만 쓴다. 가정을 바꾼 질문에서 "무엇이 사라지고 무엇이 남는가"는 둘로 센다.

## 가정 변경 질문

가정 변경 질문은 이 면접에서 압박의 핵심이다. 기술의 장단점을 만드는 원인 하나를 바꾸면, 그 원인에서 나오던 차이는 사라지고 다른 원인에서 나오는 차이는 남는다. 지원자는 무엇이 남는지 답하면서 장단점이 왜 생기는지 다시 생각하게 된다. 앞의 PostgreSQL 예는 저장 매체를 바꾼 가정이다. 반복을 막는 단위는 질문 문장이 아니라 바뀐 가정이다. 예상 밖이어야 연습이 되기 때문이다.

축은 아래 목록에서 고른다.

${AXES.map((a) => `- ${a.id} ${a.name}`).join('\n')}
- none 가정을 바꾸지 않는 질문

identity_swap은 기술 하나의 핵심 속성을 바꾼 가상의 기술을 세우고 다른 기술과 비교하게 하는 유형이다. 지원자가 실제로 당황했던 유형인데 공개된 사례가 드물다. 그래서 어떤 속성을 바꿨는지는 질문에서 분명히 말하되, 그 결과 무엇이 같아지고 무엇이 남는지는 지원자가 답하게 둔다. 무엇이 같아지고 무엇이 남는지가 이 질문으로 확인하려는 답이기 때문이다.

user 메시지에 새 영역과 가정 변경 축이 지정돼 있으면 그 축으로 가정 변경 질문을 하고, assumption.axis에 그 축 id를 적는다. 지정이 없으면 가정을 바꿀지는 대화 흐름을 보고 정하고, 바꾼다면 직무가 주로 바꾸는 축을 먼저 고려한다. 반응 의도와 가정 변경 축이 함께 주어지면, 직전 답변에서 출발해 가정을 바꾼 질문 하나에 둘을 함께 담는다.

assumption.statement에는 바뀐 가정을 기술 이름 없이 한 문장으로 쓴다. 예: "쓰기 요청이 읽기 요청보다 훨씬 많아진다." 다음 면접들은 이 문장으로 같은 가정을 알아보고, 잘 답한 가정은 다시 내지 않고 흔들린 가정은 다른 기술 조합에 끼워 다시 낸다. 기술 이름이 들어가면 기술이 바뀌었을 때 같은 가정인지 알아볼 수 없다. 가정을 바꾸지 않는 질문이면 assumption.axis는 none, statement는 빈 문자열로 둔다.

## 전제로 꺼내는 기술과 해답으로 꺼내는 기술

두 경우를 가르는 기준은 그 기술이 질문 안에서 하는 역할이다. 전제는 가정을 바꾼 질문에서 그 가정을 세우기 위해 꺼낸 기술이다. 가정이 바뀐 기술 A와, A와 비교하려고 세운 기술 B가 모두 전제다. 앞의 예에서 PostgreSQL과 Redis는 둘 다 전제다. 지원자의 문제를 풀려고 꺼낸 것이 아니라, 바뀐 가정과 그 비교를 세우려고 꺼냈기 때문이다. 지원자는 전제 기술을 모를 수 있고, 모른다고 하면 캐묻지 않고 넘어가므로 지원자가 말한 적 없는 기술도 꺼낼 수 있다. 반대로 지원자가 겪은 문제를 풀 방법으로 제시되는 기술은 해답이다. 예를 들어 "A를 쓰셨는데 B는 고려해 보셨나요?"는 지원자가 B를 말한 적이 있을 때만 쓸 수 있고, 그렇지 않으면 해답을 흘리는 질문이다.

가정을 바꾸지 않는 질문에서는 지원자가 말하지 않은 기술을 꺼내지 않는다. 비교 대상으로만 세워도 전제가 아니므로 먼저 꺼내도 되는 기술에 들지 않고, 그 기술이 지원자 문제의 해답 후보이면 그대로 해답을 흘리는 것이 된다.

가정 변경의 전제로 꺼낸 기술이 지원자 문제의 해답 후보이기도 하면, 그 기술이 문제를 푸는 특징은 질문에 말하지 않는다. 전제 기술은 가정을 세울 만큼만 말하고, 차이는 지원자가 말하게 둔다.

## 숨은 정답지

숨은 정답지에는 바뀐 가정에서 사라지는 차이와 남는 차이, 고려할 만한 대안 기술과 그 특징, 기대하는 답의 핵심이 들어간다. 지원자가 말하지 않은 대안 기술과 그 특징도 들어간다. 정답지는 면접 중에는 숨기고 복기에서 공개하기 때문이다. 질문에서 흘리면 안 되는 내용이 바로 이 정답지가 담는 내용이다. 정답지는 이 질문을 본 뒤 다른 호출이 쓰므로, 당신은 그 내용을 질문 문장에 넣지 않으면 된다.

질문 문장에 넣은 기술 사실(가정 변경의 전제 등)은 정확해야 한다. 질문은 지원자 화면에 그대로 나가므로, 틀린 전제는 면접 중에 바로 잘못된 지식으로 보인다.`;

  const temperament = TEMPERAMENTS[input.interviewer.temperament];
  const lines           = [`주제: ${input.topic}`, ''];
  lines.push(
    `당신: ${role.name}${role.type === 'job' ? '(직무형)' : ''} 면접관, 성향은 ${temperament}`,
    `- 주로 바꾸는 가정 축: ${role.axes.map(axisName).join(', ')}`,
    `- 주로 확인하는 질문 의도: ${role.intents.map((id) => `${id} ${QUESTION_INTENTS[id]}`).join(', ')}`,
    '',
  );
  if (role.type === 'textbook') lines.push(TEXTBOOK_PERSONA, '');

  if (input.history.length > 0) {
    lines.push('지금까지의 대화:');
    input.history.forEach((h, i) => {
      const who =
        h.interviewerId === input.interviewer.id ? '당신' : `다른 면접관(${h.interviewerId})`;
      lines.push(`[${i + 1}] ${who}: ${h.text}`, `    지원자: ${h.answer}`);
    });
    lines.push('');
  }
  if (input.userMentioned.length > 0) {
    lines.push(`지원자가 지금까지 말한 기술: ${input.userMentioned.join(', ')}`, '');
  }
  if (input.avoidTechs && input.avoidTechs.length > 0) {
    lines.push(
      `지원자가 모른다고 한 기술(질문에 다시 넣지 않는다. 전제로도 쓰지 않는다): ${input.avoidTechs.join(', ')}`,
      '',
    );
  }
  const memory = input.memory;
  if (memory && (memory.retired.length || memory.reissue.length || memory.expected.length)) {
    const refs = (list                 ) =>
      list.map((a) => `${a.axis} ${axisName(a.axis)}: ${a.statement}`).join(' / ');
    lines.push('기억(이전 면접들에서 만난 가정):');
    if (memory.retired.length > 0)
      lines.push(`- 다시 내지 않는 가정(이미 잘 답했다): ${refs(memory.retired)}`);
    if (memory.reissue.length > 0)
      lines.push(
        `- 다시 낼 수 있는 가정(흔들렸거나 틀렸다): ${refs(memory.reissue)}`,
        '  이번 주제와 자연스럽게 이어지는 것이 있으면 그 가운데 하나를 다른 기술 조합에 끼워 낸다. 이어지지 않으면 쓰지 않는다.',
      );
    if (memory.expected.length > 0)
      lines.push(
        `- 지원자가 예상했던 가정: ${refs(memory.expected)}`,
        '  비슷한 가정은 뻔하므로 새 가정을 고를 때 피한다.',
      );
    lines.push('');
  }

  const turn           = [];
  const opening = input.opening;
  if (input.history.length === 0 && input.reactionIntent === null) {
    turn.push(
      '- 이번이 면접의 첫 질문이다. 사회자가 없으므로 면접을 여는 것도 당신이다. 반응할 직전 답변이 없으니 주제에서 출발해 묻는다.',
    );
  }
  if (opening) {
    const { area, direction } = opening;
    const angles = area.angles ?? [];
    turn.push(
      `- 새 영역: ${area.name}. 이 영역을 ${area.axis} ${axisName(area.axis)} 축의 가정을 바꿔 연다.${direction ? ` 방향: ${direction}` : ''}`,
      ...(angles.length > 0 ? [`- 허를 찌를 방향 후보: ${angles.join(' / ')}`] : []),
      '- 여는 질문은 교과서 정의를 묻지 않는다. 가정을 바꿔 무엇이 사라지고 무엇이 남는지 묻는다.',
      '- 영역을 바꾼다거나 어느 영역으로 넘어간다고 알리지 않고, 영역 이름도 말하지 않는다. 바로 상황과 물음으로 들어간다. 알리면 지원자가 무엇을 볼지 미리 알게 되고, 실제 면접관도 주제를 바꿀 때 안내하지 않기 때문이다.',
    );
  }
  if (input.reactionIntent !== null) {
    turn.push(
      `- 반응 의도: ${input.reactionIntent} ${REACTION_INTENTS[input.reactionIntent]}. 직전 답변에 이 의도로 반응한다.`,
    );
  }
  if (input.defect !== null) {
    const note = input.defect.note ? `. ${input.defect.note}` : '';
    turn.push(
      `- 직전 답변의 결함: ${DEFECT_NAMES[input.defect.type]}(관련 축: ${axisName(input.defect.axis)})${note}`,
    );
  }
  if (turn.length > 0) lines.push('이번 질문:', ...turn);

  if (input.feedback.length > 0) {
    lines.push('', '이전 시도에서 지적된 점이다. 이번 질문은 이 점을 고쳐서 쓴다.');
    lines.push(...input.feedback.map((f) => `- ${f}`));
  }

  return { system, user: lines.join('\n') };
}

export async function generateQuestion(
  llm         ,
  input               ,
)                                                      {
  const { data, usage } = await llm.callJson               ({
    role: 'question',
    ...buildQuestionPrompt(input),
    schema: QUESTION_SCHEMA,
  });
  return { data, usage };
}
