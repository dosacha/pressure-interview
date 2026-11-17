import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { engineConfig } from '../config/engine.config';
import { OWNABLE_AXES, ROLES } from './catalog';
import { analyzeAnswer } from './calls/analyze.call';
import { detectTechs } from './calls/leak.call';
import { generateQuestion } from './calls/question.call';
import { verifyAnswerKey } from './calls/verify.call';
import { LlmService } from './llm/llm.service';
import { checkNaming } from './naming';
import { pickNext } from './rules';
import type {
  AnswerInput,
  AnswerResult,
  Defect,
  PreparedQuestion,
  QuestionInput,
  TechMention,
  TokenUsage,
  Verification,
} from './types';

@Injectable()
export class TurnService {
  constructor(
    private readonly llm: LlmService,
    @Inject(engineConfig.KEY) private readonly config: ConfigType<typeof engineConfig>,
  ) {}

  async prepareQuestion(input: QuestionInput): Promise<PreparedQuestion> {
    const usage: TokenUsage[] = [];
    const attempts: PreparedQuestion['attempts'] = [];
    const feedback = [...input.feedback];
    let verification: Verification | null = null;
    let leak = false;

    for (let i = 0; i <= this.config.maxRegenerations; i++) {
      const generated = await generateQuestion(this.llm, { ...input, feedback });
      const question = generated.data;
      usage.push(generated.usage);
      const detected = await detectTechs(this.llm, {
        questionText: question.text,
        userMentioned: input.userMentioned,
      });
      usage.push(detected.usage);
      const techs = detected.data.techs;
      // 설계 6.3: premise는 가정 변경의 전제일 때만 허용한다. 가정 없는 질문의 premise는 해답으로 본다.
      const checked =
        question.assumption.axis === 'none'
          ? techs.map((t): TechMention => (t.role === 'premise' ? { ...t, role: 'solution' } : t))
          : techs;
      const naming = checkNaming({ techs: checked, userMentioned: input.userMentioned });
      verification = null;
      if (naming.ok && question.assumption.axis !== 'none') {
        const verified = await verifyAnswerKey(this.llm, { topic: input.topic, question });
        usage.push(verified.usage);
        verification = verified.data;
      }
      attempts.push({ question, naming, verification, techs });

      leak = !naming.ok;
      if (leak) {
        feedback.push(`해답으로 꺼내면 안 되는 기술: ${naming.violations.join(', ')}`);
      } else if (verification && !verification.premiseOk) {
        feedback.push(...verification.problems.map((p) => p.problem));
      } else {
        break;
      }
    }

    const last = attempts[attempts.length - 1];
    const answerKeyCorrected = verification !== null && verification.problems.length > 0;
    return {
      question:
        verification && answerKeyCorrected
          ? { ...last.question, answerKey: verification.answerKey }
          : last.question,
      verification,
      answerKeyCorrected,
      flags: { leak, premise: verification !== null && !verification.premiseOk },
      attempts,
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
    if (analysis.kind === 'clarify') return { analysis, pick: null, userMentioned, usage: [usage] };

    const questionAxis = input.question.assumption.axis;
    const axis = OWNABLE_AXES.find((a) => a === questionAxis) ?? ROLES[asker.role].axes[0];
    if (unknownTechs.length > 0) {
      // shortcut: 모른다고 한 기술은 다음 한 질문에만 note로 넘긴다, 여러 턴에 걸쳐 기억하는 것은 계획 2의 세션 상태에서
      // shortcut: 같은 면접관이 이어 묻고 연속 상한은 보지 않는다, 계획 2에서 턴 진행 규칙과 함께 정리
      const note = `지원자가 ${unknownTechs.join(', ')}에 대해 모른다고 했다. 써 보지 않은 기술을 모르는 것은 결함이 아니라서 결함 없음으로 두었고, 아래는 판정이 아니라 이번 질문이 지킬 조건이다. 그 기술의 이름을 다시 말하지 않고 "그 부분은 알겠습니다"처럼 받은 뒤 다음으로 넘어간다. 그 기술을 설명하지 않고, 이번 질문에서는 가정을 세우는 전제로도 쓰지 않는다. 설명하면 면접 중에 가르치게 되고, 다시 꺼내면 지원자가 답할 수 없는 것을 또 묻게 되기 때문이다. 받는 말에 이름만 넣어도 해답으로 꺼낸 것으로 지적되므로, 이전 시도에서 지적된 점에 그 기술이 나오면 질문 문장 어디에도 그 이름을 쓰지 않는다.`;
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
    return { analysis, pick, userMentioned, usage: [usage] };
  }
}
