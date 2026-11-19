// 스킬이 만든 파일이다.
import { THRESHOLDS } from '../../../thread.mjs';

const pct = (r) => `${Math.round(r * 100)}%`;

const numbers = (description) => ({ type: 'array', items: { type: 'integer' }, description });

export const END_JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'evidence', 'candidates', 'nextArea', 'direction', 'note'],
  properties: {
    decision: { type: 'string', enum: ['continue', 'enough', 'exhausted', 'settled'], description: '판정' },
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: ['knows', 'applies', 'learns'],
      description: 'enough일 때 기준마다 충족한 근거 줄기 번호. 아니면 빈 배열',
      properties: {
        knows: numbers('잘 앎의 근거 줄기 번호'),
        applies: numbers('바로 쓸 수 있음의 근거 줄기 번호'),
        learns: numbers('빨리 배움의 근거 줄기 번호'),
      },
    },
    candidates: {
      type: 'array',
      description: 'exhausted일 때 직접 써 본 다음 질문 후보 셋. 아니면 빈 배열',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'verdict', 'why'],
        properties: {
          question: { type: 'string', description: '후보 질문' },
          verdict: { type: 'string', enum: ['repeat', 'contrived', 'offTopic', 'ok'], description: '걸린 까닭' },
          why: { type: 'string', description: '그렇게 본 까닭' },
        },
      },
    },
    nextArea: { type: 'string', description: 'continue일 때 다음 영역 id. 끝낼 때는 빈 문자열' },
    direction: { type: 'string', description: 'continue일 때 다음 여는 질문의 방향 한 문장. 끝낼 때는 빈 문자열' },
    note: { type: 'string', description: '이 판정의 까닭 한두 문장. 복기에 보인다' },
  },
};

function ledgerLine(t) {
  const lines = [
    `줄기 ${t.no} (영역 ${t.areaId})`,
    `  여는 질문: ${t.openText} -> 점수 ${t.openScore ?? '없음'}`,
  ];
  if (t.followText) lines.push(`  꼬리질문(${t.followKind}): ${t.followText} -> 점수 ${t.followScore ?? '없음'}`);
  lines.push(`  줄기 점수: ${t.score ?? '없음(점수에서 뺀다)'}`);
  if (t.depthLimit) lines.push('  깊이 한계: 심화 꼬리질문에서 막혔다(줄기 점수는 깎지 않았다)');
  if (t.unknownPremise) lines.push('  전제 기술을 모른다고 해서 이 줄기는 점수가 없다');
  for (const s of t.signals ?? []) lines.push(`  신호 ${s.type}: "${s.quote}"`);
  return lines.join('\n');
}

export function buildEndJudgePrompt({ topic, topicMap, ledger, unaskedAreaIds }) {
  const t = THRESHOLDS;
  const system = `기술 압박 면접에서 줄기(여는 질문 하나와 꼬리질문 하나)가 하나 닫힐 때마다, 지금까지의 근거 장부를 보고 면접을 끝낼지 계속할지 판정한다. 이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구다. 판정이 틀리면 면접이 일찍 끝나거나 끝나지 않는다.

입력은 주제, 주제 지도, 근거 장부, 아직 안 물은 영역 목록이다. 장부는 줄기마다 영역, 질문 문장, 점수, 신호와 그 인용, 줄기 점수, 깊이 한계를 싣는다. 대화 전체와 답의 전문은 없다. 장부에 적힌 점수와 인용만으로 판정한다.

점수는 solid(잘 앎), mostly(대체로 앎), unclear(애매함), wrong(틀림/모름) 넷이다. 신호는 practical(실무 적용), reasoning(추론), selfCorrection(스스로 고침) 셋이다. 점수가 없는 줄기는 비율에서 뺀다.

판정은 continue, enough, exhausted, settled 넷 가운데 하나다. 근거가 모자라면 끝내지 말고 continue로 한다. 코드가 조건을 다시 세어 맞지 않으면 continue로 바꾼다.

## enough: 볼 만큼 봤다

아래 셋을 모두 채울 때만 쓴다.
- 잘 앎: 핵심 영역을 모두 물었다. 핵심 영역 줄기의 ${pct(t.CORE_MOSTLY_RATIO)} 이상이 mostly 이상이고, solid가 ${t.CORE_SOLID_RATIO === 0.5 ? '절반' : pct(t.CORE_SOLID_RATIO)} 이상이다.
- 바로 쓸 수 있음: practical 신호가 서로 다른 줄기 ${t.PRACTICAL_THREADS}개 이상에 있고, 그 줄기들이 mostly 이상이다.
- 빨리 배움: reasoning 또는 selfCorrection 신호가 ${t.LEARNING_SIGNALS}번 이상 있다.

evidence에 기준마다 충족한 근거 줄기 번호를 knows, applies, learns로 적는다. 댄 줄기는 실제로 그 기준을 채우는 줄기여야 한다.

## exhausted: 더 물을 게 없다

- 핵심 영역을 모두 물었다.
- 다음 질문 후보 셋을 직접 써 본다. 셋이 모두 아래 가운데 하나에 걸릴 때만 쓴다. 하나라도 걸리지 않으면(ok) 계속한다.
  - repeat: 이미 물은 가정의 되풀이다.
  - contrived: 이 기술을 실제로 쓰지 않는 상황을 꾸며야 나온다.
  - offTopic: 주제에서 벗어난 다른 기술의 지식을 시험하게 된다.
- candidates에 후보 셋(question, verdict, why)을 적는다. 각 후보가 걸린 까닭을 why에 쓴다.

## settled: 판단이 섰다

약한 경우다. 아래를 모두 채울 때만 쓴다.
- 핵심 영역을 모두 물었다. 핵심 영역을 다 돌기 전에는 이 까닭으로 끝내지 않는다. 약한 영역 하나 때문에 다른 영역을 볼 기회를 잃지 않게 하려는 것이다.
- 핵심 영역 줄기의 ${pct(t.SETTLED_WRONG_RATIO)} 이상이 wrong이다.
- reasoning, selfCorrection 신호가 하나도 없다.

## continue: 계속한다

위 셋이 아니면 계속한다.
- nextArea: 다음 영역 id. 아직 안 물은 핵심 영역이 있으면 그 가운데서, 없으면 주변 영역이나 이미 물은 영역의 다른 각도에서 고른다. 주제 지도의 id만 쓴다.
- direction: 그 영역을 여는 질문의 방향 한 문장.

## 출력

끝낼 때(enough, exhausted, settled)는 nextArea와 direction을 빈 문자열로 둔다. continue일 때 evidence는 세 배열 모두 비우고 candidates도 비운다. note에는 이 판정의 까닭을 한두 문장으로 쓴다. 복기에서 지원자가 읽는다.`;

  const areas = topicMap.areas
    .map((a) => `- ${a.id} ${a.name} (${a.core ? '핵심' : '주변'}): ${a.why}`)
    .join('\n');
  const user = [
    `주제: ${topic}`,
    '',
    '주제 지도:',
    areas,
    '',
    `아직 안 물은 영역: ${unaskedAreaIds.length > 0 ? unaskedAreaIds.join(', ') : '없음'}`,
    '',
    '근거 장부:',
    ledger.length > 0 ? ledger.map(ledgerLine).join('\n') : '(아직 닫힌 줄기가 없다)',
  ].join('\n');

  return { system, user };
}

export async function judgeEnd(llm, input) {
  const { data, usage } = await llm.callJson({
    role: 'analyze',
    ...buildEndJudgePrompt(input),
    schema: END_JUDGE_SCHEMA,
  });
  return { data, usage };
}
