import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { engineConfig } from '../config/engine.config';
import { OWNABLE_AXES, ROLES } from './catalog';
import { analyzeAnswer } from './calls/analyze.call';
import { writeAnswerKey } from './calls/answer-key.call';
import { answerClarification } from './calls/clarify.call';
import { pickJobRole } from './calls/job-role.call';
import { detectTechs } from './calls/leak.call';
import { checkPremise } from './calls/premise.call';
import { generateQuestion } from './calls/question.call';
import { reviewTurn } from './calls/review.call';
import { verifyAnswerKey } from './calls/verify.call';
import { LlmService } from './llm/llm.service';
import { checkNaming } from './naming';
import { pickNext } from './rules';
import type {
  AnswerInput,
  AnswerKeyInput,
  AnswerResult,
  ClarifyInput,
  ClarifyResult,
  CompletedQuestion,
  Defect,
  JobRoleId,
  NamingResult,
  PreparedDraft,
  PremiseCheck,
  QuestionInput,
  ReviewInput,
  TechMention,
  TokenUsage,
  TurnReview,
} from './types';

// 이름 위반을 다음 시도에 줄 피드백 문장으로 바꾼다. 해답 위반 먼저, 이름은 한 문장에만 넣는다.
function namingFeedback(naming: NamingResult): string[] {
  const feedback: string[] = [];
  const solutions = naming.violations.filter((n) => !naming.avoided.includes(n));
  if (solutions.length > 0) feedback.push(`해답으로 꺼내면 안 되는 기술: ${solutions.join(', ')}`);
  if (naming.avoided.length > 0)
    feedback.push(
      `지원자가 모른다고 해서 질문에 다시 넣으면 안 되는 기술: ${naming.avoided.join(', ')}`,
    );
  return feedback;
}

@Injectable()
export class TurnService {
  constructor(
    private readonly llm: LlmService,
    @Inject(engineConfig.KEY) private readonly config: ConfigType<typeof engineConfig>,
  ) {}

  // 화면에 낼 질문만 만든다. 정답지는 completeQuestion이 질문이 나간 뒤에 쓴다.
  async prepareDraft(input: QuestionInput): Promise<PreparedDraft> {
    const usage: TokenUsage[] = [];
    const attempts: PreparedDraft['attempts'] = [];
    const feedback = [...input.feedback];
    let premise: PremiseCheck | null = null;
    let leak = false;

    for (let i = 0; i <= this.config.maxRegenerations; i++) {
      const generated = await generateQuestion(this.llm, { ...input, feedback });
      const draft = generated.data;
      usage.push(generated.usage);
      const detected = await detectTechs(this.llm, {
        questionText: draft.text,
        userMentioned: input.userMentioned,
      });
      usage.push(detected.usage);
      const techs = detected.data.techs;
      // 설계 6.3: premise는 가정 변경의 전제일 때만 허용한다. 가정 없는 질문의 premise는 해답으로 본다.
      const checked =
        draft.assumption.axis === 'none'
          ? techs.map((t): TechMention => (t.role === 'premise' ? { ...t, role: 'solution' } : t))
          : techs;
      const naming = checkNaming({
        techs: checked,
        userMentioned: input.userMentioned,
        avoid: input.avoidTechs,
      });
      premise = null;
      // 설계 6.2-6: 틀린 전제가 화면에 나가지 않게, 가정을 바꾼 질문은 보여 주기 전에 전제만 검사한다.
      if (naming.ok && draft.assumption.axis !== 'none') {
        const result = await checkPremise(this.llm, { topic: input.topic, draft });
        usage.push(result.usage);
        premise = result.data;
      }
      attempts.push({ draft, naming, premise, techs });

      leak = !naming.ok;
      if (leak) {
        feedback.push(...namingFeedback(naming));
      } else if (premise && !premise.premiseOk) {
        feedback.push(...premise.problems.map((p) => p.problem));
      } else {
        break;
      }
    }

    return {
      draft: attempts[attempts.length - 1].draft,
      premise,
      flags: { leak, premise: premise !== null && !premise.premiseOk },
      attempts,
      usage,
    };
  }

  // 질문이 나간 뒤에 정답지를 쓰고 검증한다. 검증에서 전제가 틀렸다고 나와도 질문은 다시 만들지 않는다.
  async completeQuestion(input: AnswerKeyInput): Promise<CompletedQuestion> {
    const written = await writeAnswerKey(this.llm, input);
    const verified = await verifyAnswerKey(this.llm, {
      topic: input.topic,
      question: { ...input.draft, answerKey: written.data },
    });
    return {
      question: { ...input.draft, answerKey: verified.data.answerKey },
      verification: verified.data,
      answerKeyCorrected: verified.corrected,
      usage: [written.usage, verified.usage],
    };
  }

  async replyToClarification(input: ClarifyInput): Promise<ClarifyResult> {
    const usage: TokenUsage[] = [];
    const feedback: string[] = [];
    // 질문에 이미 나온 기술은 다시 말해도 흘림이 아니다.
    const allowed = [...input.userMentioned, ...input.questionTechs.map((t) => t.name)];
    let reply = '';
    let leak = false;

    for (let i = 0; i <= this.config.maxRegenerations; i++) {
      const answered = await answerClarification(this.llm, { ...input, feedback });
      usage.push(answered.usage);
      reply = answered.data.reply;
      const detected = await detectTechs(this.llm, { questionText: reply, userMentioned: allowed });
      usage.push(detected.usage);
      // 응답은 새 가정을 세우지 않으므로 premise도 해답으로 본다.
      const techs = detected.data.techs.map(
        (t): TechMention => (t.role === 'premise' ? { ...t, role: 'solution' } : t),
      );
      const naming = checkNaming({ techs, userMentioned: allowed, avoid: input.avoidTechs });
      leak = !naming.ok;
      if (!leak) break;
      feedback.push(...namingFeedback(naming));
    }
    return { reply, leak, usage };
  }

  async pickJobRole(topic: string): Promise<{ role: JobRoleId; usage: TokenUsage }> {
    const { data, usage } = await pickJobRole(this.llm, topic);
    return { role: data.role, usage };
  }

  // 모델이 없는 결함·질문·가정을 가리켜도 뒤 단계가 흔들리지 않게 그런 항목을 버리거나 비운다.
  async reviewTurn(input: ReviewInput): Promise<{ review: TurnReview; usage: TokenUsage }> {
    const { data, usage } = await reviewTurn(this.llm, input);
    const inRange = (index: number, length: number) => index >= 0 && index < length;
    const { sameAs } = data.assumption;
    return {
      review: {
        ...data,
        defects: data.defects.filter((d) => inRange(d.index, input.analysis.defects.length)),
        reactions: data.reactions.filter((r) => inRange(r.index, input.followUps.length)),
        assumption: {
          ...data.assumption,
          sameAs: input.knownAssumptions.some((a) => a.key === sameAs) ? sameAs : null,
        },
      },
      usage,
    };
  }

  async handleAnswer(input: AnswerInput): Promise<AnswerResult> {
    const asker = input.panel.find((m) => m.id === input.askedBy);
    if (!asker) throw new Error(`패널에 없는 면접관이다: ${input.askedBy}`);

    const { data: analysis, usage } = await analyzeAnswer(this.llm, {
      topic: input.topic,
      question: input.question,
      answer: input.answer,
      userMentioned: input.userMentioned,
    });
    // 이미 말한 기술(주제 기술 포함)에 대한 모름은 넘어가지 않는다. 분석이 프롬프트를 어겨 넣어도 여기서 거른다.
    const unknownTechs = (analysis.unknownTechs ?? []).filter(
      (t) => !input.userMentioned.includes(t),
    );
    // 분석이 모른다고 한 기술을 mentionedTechs에도 넣었으면 뺀다. 면접관이 먼저 꺼내도 되는 기술이 되기 때문이다.
    const mentioned = analysis.mentionedTechs.filter((t) => !unknownTechs.includes(t));
    const userMentioned = [...new Set([...input.userMentioned, ...mentioned])];
    if (analysis.kind === 'clarify')
      return { analysis, pick: null, userMentioned, usage: [usage], unknownTechs };

    const questionAxis = input.question.assumption.axis;
    const axis = OWNABLE_AXES.find((a) => a === questionAxis) ?? ROLES[asker.role].axes[0];
    if (unknownTechs.length > 0) {
      // shortcut: 같은 면접관이 이어 묻고 연속 상한은 보지 않는다, 계획 2에서 턴 진행 규칙과 함께 정리
      const note = `지원자가 ${unknownTechs.join(', ')}에 대해 모른다고 했다. 써 보지 않은 기술을 모르는 것은 결함이 아니라서 결함 없음으로 두었고, 아래는 판정이 아니라 이번 질문이 지킬 조건이다. 그 기술의 이름을 다시 말하지 않고 "그 부분은 알겠습니다"처럼 받은 뒤 다음으로 넘어간다. 그 기술을 설명하지 않고, 이번 질문에서는 가정을 세우는 전제로도 쓰지 않는다. 설명하면 면접 중에 가르치게 되고, 다시 꺼내면 지원자가 답할 수 없는 것을 또 묻게 되기 때문이다.`;
      return {
        analysis,
        pick: {
          interviewerId: asker.id,
          reactionIntent: 'B11',
          defect: { type: 'none', axis, note },
          secondary: null,
        },
        userMentioned,
        usage: [usage],
        unknownTechs,
      };
    }
    const defects: Defect[] =
      analysis.defects.length > 0 ? analysis.defects : [{ type: 'none', axis, note: '' }];
    const pick = pickNext({
      defects,
      panel: input.panel,
      history: input.history,
      maxConsecutive: this.config.maxConsecutive,
    });
    return { analysis, pick, userMentioned, usage: [usage], unknownTechs };
  }
}
