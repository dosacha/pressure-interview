import { readFileSync } from 'fs';
import type { AxisId } from '../../src/interview/catalog';
import { verifyAnswerKey } from '../../src/interview/calls/verify.call';
import { JsonLlm, RefusalError } from '../../src/interview/llm/llm.service';
import type { TurnService } from '../../src/interview/turn.service';
import type { PanelMember, QuestionInput, TokenUsage } from '../../src/interview/types';
import type { R1FollowUp, R1Result, R1Step } from './report';

export interface Scenario {
  id: string;
  topic: string;
  panel: PanelMember[];
  first: { interviewerId: string; targetAxis: AxisId };
  answers: { kind: string; text: string }[];
}

export interface R1Deps {
  turn: Pick<TurnService, 'prepareQuestion' | 'handleAnswer'>;
  llm: JsonLlm;
  log: (line: string) => void;
}

// shortcut: 형식 검사 없이 타입만 붙인다, 시나리오를 사용자가 직접 쓰게 되면 검증 추가
export function readScenarios(file: string): Scenario[] {
  return JSON.parse(readFileSync(file, 'utf8')) as Scenario[];
}

function describeError(e: unknown): string {
  if (e instanceof RefusalError) return `refusal: ${e.category ?? '카테고리 없음'}`;
  return e instanceof Error ? e.message : String(e);
}

function member(panel: PanelMember[], id: string): PanelMember {
  const m = panel.find((p) => p.id === id);
  if (!m) throw new Error(`패널에 없는 면접관이다: ${id}`);
  return m;
}

// 질문이 만들어지면 사후 검증 전에 save로 넘긴다. 사후 검증이 실패해도 질문은 결과에 남는다.
async function makeStep(
  deps: R1Deps,
  label: string,
  input: QuestionInput,
  usage: TokenUsage[],
  save: (step: R1Step) => void,
): Promise<R1Step> {
  deps.log(`${label} 질문 생성`);
  const prepared = await deps.turn.prepareQuestion(input);
  usage.push(...prepared.usage);
  const step: R1Step = {
    prepared,
    lateVerification: null,
    askedBy: input.interviewer.id,
    targetAxis: input.targetAxis,
  };
  save(step);
  if (prepared.question.assumption.axis !== 'none') return step;
  deps.log(`${label} 사후 검증`);
  const verified = await verifyAnswerKey(deps.llm, {
    topic: input.topic,
    question: prepared.question,
  });
  usage.push(verified.usage);
  step.lateVerification = verified.data;
  return step;
}

export async function runScenarios(deps: R1Deps, scenarios: Scenario[]): Promise<R1Result[]> {
  const results: R1Result[] = [];
  for (const s of scenarios) {
    const result: R1Result = {
      scenarioId: s.id,
      topic: s.topic,
      panel: s.panel,
      first: null,
      followUps: [],
      usage: [],
      error: null,
      answerCount: s.answers.length,
    };
    results.push(result);
    try {
      const askedBy = s.first.interviewerId;
      const first = await makeStep(
        deps,
        `[${s.id}] 첫 질문`,
        {
          topic: s.topic,
          interviewer: member(s.panel, askedBy),
          reactionIntent: null,
          defect: null,
          targetAxis: s.first.targetAxis,
          history: [],
          userMentioned: [s.topic],
          feedback: [],
        },
        result.usage,
        (step) => (result.first = step),
      );
      // 설계 6.2의 6단계: 사후 검증이 정답지를 고쳤으면 이후 반응에는 고친 정답지를 쓴다.
      const late = first.lateVerification;
      const question =
        late && late.problems.length > 0
          ? { ...first.prepared.question, answerKey: late.answerKey }
          : first.prepared.question;

      for (const [i, a] of s.answers.entries()) {
        const label = `[${s.id}] 답 ${i + 1}/${s.answers.length} (${a.kind})`;
        deps.log(`${label} 분석`);
        const answered = await deps.turn.handleAnswer({
          topic: s.topic,
          panel: s.panel,
          history: [askedBy],
          askedBy,
          question,
          answer: a.text,
          userMentioned: [s.topic],
        });
        result.usage.push(...answered.usage);
        const { pick } = answered;
        // 분석이 끝나면 먼저 남긴다. 후속 질문이 실패해도 이미 받은 analysis와 pick은 결과에 있다.
        const followUp: R1FollowUp = {
          answerKind: a.kind,
          answer: a.text,
          analysis: answered.analysis,
          pick,
          next: null,
        };
        result.followUps.push(followUp);
        if (pick) {
          await makeStep(
            deps,
            `${label} 후속`,
            {
              topic: s.topic,
              interviewer: member(s.panel, pick.interviewerId),
              reactionIntent: pick.reactionIntent,
              defect: pick.defect,
              targetAxis: null,
              history: [{ interviewerId: askedBy, text: question.text, answer: a.text }],
              userMentioned: answered.userMentioned,
              feedback: [],
            },
            result.usage,
            (step) => (followUp.next = step),
          );
        }
      }
      deps.log(`[${s.id}] 끝`);
    } catch (e) {
      result.error = describeError(e);
      deps.log(`[${s.id}] 오류: ${result.error}`);
    }
  }
  return results;
}
