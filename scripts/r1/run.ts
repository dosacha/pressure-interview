import { readFileSync } from 'fs';
import type { AxisId } from '../../src/interview/catalog';
import { verifyAnswerKey } from '../../src/interview/calls/verify.call';
import { JsonLlm, RefusalError } from '../../src/interview/llm/llm.service';
import type { TurnService } from '../../src/interview/turn.service';
import type { PanelMember, QuestionInput, TokenUsage } from '../../src/interview/types';
import type { R1Result, R1Step } from './report';

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

async function makeStep(deps: R1Deps, input: QuestionInput, usage: TokenUsage[]): Promise<R1Step> {
  const prepared = await deps.turn.prepareQuestion(input);
  usage.push(...prepared.usage);
  if (prepared.question.assumption.axis !== 'none') return { prepared, lateVerification: null };
  const verified = await verifyAnswerKey(deps.llm, {
    topic: input.topic,
    question: prepared.question,
  });
  usage.push(verified.usage);
  return { prepared, lateVerification: verified.data };
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
    };
    results.push(result);
    try {
      const askedBy = s.first.interviewerId;
      deps.log(`[${s.id}] 첫 질문`);
      const first = await makeStep(
        deps,
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
      );
      result.first = first;
      const question = first.prepared.question;

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
        let next: R1Step | null = null;
        if (pick) {
          deps.log(`${label} 후속 질문`);
          next = await makeStep(
            deps,
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
          );
        }
        result.followUps.push({
          answerKind: a.kind,
          answer: a.text,
          analysis: answered.analysis,
          pick,
          next,
        });
      }
      deps.log(`[${s.id}] 끝`);
    } catch (e) {
      result.error = describeError(e);
      deps.log(`[${s.id}] 오류: ${result.error}`);
    }
  }
  return results;
}
