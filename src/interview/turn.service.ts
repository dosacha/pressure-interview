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
      const naming = checkNaming({
        techs: detected.data.techs,
        userMentioned: input.userMentioned,
      });
      verification = null;
      if (naming.ok && question.assumption.axis !== 'none') {
        const verified = await verifyAnswerKey(this.llm, { topic: input.topic, question });
        usage.push(verified.usage);
        verification = verified.data;
      }
      attempts.push({ question, naming, verification });

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
    });
    const userMentioned = [...new Set([...input.userMentioned, ...analysis.mentionedTechs])];
    if (analysis.kind === 'clarify') return { analysis, pick: null, userMentioned, usage: [usage] };

    const questionAxis = input.question.assumption.axis;
    const axis = OWNABLE_AXES.find((a) => a === questionAxis) ?? ROLES[asker.role].axes[0];
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
