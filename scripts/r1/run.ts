import { readFileSync } from 'fs';
import type { AxisId } from '../../src/interview/catalog';
import { JsonLlm, RefusalError } from '../../src/interview/llm/llm.service';
import type { TurnService } from '../../src/interview/turn.service';
import type {
  CompletedQuestion,
  PanelMember,
  QuestionInput,
  TokenUsage,
} from '../../src/interview/types';
import { writeCandidateAnswer, type AnswerKind } from './candidate';
import type { R1FollowUp, R1Result, R1Step } from './report';

export interface Scenario {
  id: string;
  topic: string;
  panel: PanelMember[];
  first: { interviewerId: string; targetAxis: AxisId };
  answers: { kind: AnswerKind }[];
  candidateRule?: string;
}

export interface R1Deps {
  turn: Pick<TurnService, 'prepareDraft' | 'completeQuestion' | 'handleAnswer'>;
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

// 초안이 만들어지면 정답지 작성 전에 save로 넘긴다. 정답지 작성이나 검증이 실패해도 돈을 내고 만든 초안은 결과에 남는다.
async function makeStep(
  deps: R1Deps,
  label: string,
  input: QuestionInput,
  usage: TokenUsage[],
  save: (step: R1Step) => void,
): Promise<CompletedQuestion> {
  deps.log(`${label} 질문 생성`);
  const prepared = await deps.turn.prepareDraft(input);
  usage.push(...prepared.usage);
  const step: R1Step = {
    prepared,
    completed: null,
    askedBy: input.interviewer.id,
    targetAxis: input.targetAxis,
  };
  save(step);
  deps.log(`${label} 정답지 작성과 검증`);
  const completed = await deps.turn.completeQuestion({
    topic: input.topic,
    interviewer: input.interviewer,
    reactionIntent: input.reactionIntent,
    defect: input.defect,
    addOn: input.addOn,
    history: input.history,
    draft: prepared.draft,
  });
  usage.push(...completed.usage);
  step.completed = completed;
  return completed;
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
      // 검증이 정답지를 고쳤으면 이후 반응에는 고친 정답지를 쓴다.
      const { question } = first;

      for (const [i, a] of s.answers.entries()) {
        const label = `[${s.id}] 답 ${i + 1}/${s.answers.length} (${a.kind})`;
        deps.log(`${label} 답 생성`);
        // 검증이 정답지를 고쳐도 질문 문장은 같다. 지원자에게는 문장만 준다.
        const written = await writeCandidateAnswer(deps.llm, {
          topic: s.topic,
          questionText: question.text,
          kind: a.kind,
          rule: s.candidateRule,
        });
        result.usage.push(written.usage);
        // intendedFlaw는 리포트 대조용이라 엔진 호출에는 answer만 넘긴다.
        const { answer, intendedFlaw } = written.data;
        deps.log(`${label} 분석`);
        const answered = await deps.turn.handleAnswer({
          topic: s.topic,
          panel: s.panel,
          history: [askedBy],
          askedBy,
          question,
          answer,
          userMentioned: [s.topic],
        });
        result.usage.push(...answered.usage);
        const { pick } = answered;
        // 분석이 끝나면 먼저 남긴다. 후속 질문이 실패해도 이미 받은 analysis와 pick은 결과에 있다.
        const followUp: R1FollowUp = {
          answerKind: a.kind,
          answer,
          intendedFlaw,
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
              history: [{ interviewerId: askedBy, text: question.text, answer }],
              userMentioned: answered.userMentioned,
              feedback: [],
              avoidTechs: answered.unknownTechs,
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
