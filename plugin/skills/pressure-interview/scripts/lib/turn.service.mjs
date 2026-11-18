// 앱(aeae0dd)의 src/interview/turn.service.ts를 손으로 옮긴 것이다. 앱과 다른 곳은 호출마다 종류(kind)를 붙인 껍데기로 llm을 넘기는 것뿐이다.
import { OWNABLE_AXES, ROLES } from './app/interview/catalog.mjs';
import { analyzeAnswer } from './app/interview/calls/analyze.call.mjs';
import { writeAnswerKey } from './app/interview/calls/answer-key.call.mjs';
import { answerClarification } from './app/interview/calls/clarify.call.mjs';
import { pickJobRole } from './app/interview/calls/job-role.call.mjs';
import { detectTechs } from './app/interview/calls/leak.call.mjs';
import { checkPremise } from './app/interview/calls/premise.call.mjs';
import { generateQuestion } from './app/interview/calls/question.call.mjs';
import { reviewTurn } from './app/interview/calls/review.call.mjs';
import { verifyAnswerKey } from './app/interview/calls/verify.call.mjs';
import { checkNaming, normalize } from './app/interview/naming.mjs';
import { pickNext } from './app/interview/rules.mjs';

// 이름 위반을 다음 시도에 줄 피드백 문장으로 바꾼다. 해답 위반 먼저, 이름은 한 문장에만 넣는다.
function namingFeedback(naming) {
  const feedback = [];
  const solutions = naming.violations.filter((n) => !naming.avoided.includes(n));
  if (solutions.length > 0) feedback.push(`해답으로 꺼내면 안 되는 기술: ${solutions.join(', ')}`);
  if (naming.avoided.length > 0)
    feedback.push(
      `지원자가 모른다고 해서 질문에 다시 넣으면 안 되는 기술: ${naming.avoided.join(', ')}`,
    );
  return feedback;
}

export class TurnService {
  // config에서는 maxRegenerations와 maxConsecutive만 쓴다.
  constructor(llm, config) {
    this.llm = llm;
    this.config = config;
  }

  // 실제 실행기는 req.kind로 모델을 고르므로, 호출 함수에는 종류를 붙이는 껍데기를 넘긴다.
  as(kind) {
    return { callJson: (req) => this.llm.callJson({ ...req, kind }) };
  }

  // 화면에 낼 질문만 만든다. 정답지는 completeQuestion이 질문이 나간 뒤에 쓴다.
  async prepareDraft(input) {
    const usage = [];
    const attempts = [];
    const feedback = [...input.feedback];
    let premise = null;
    let leak = false;

    for (let i = 0; i <= this.config.maxRegenerations; i++) {
      const generated = await generateQuestion(this.as('question'), { ...input, feedback });
      const draft = generated.data;
      usage.push(generated.usage);
      // 설계 6.2-6: 틀린 전제가 화면에 나가지 않게, 가정을 바꾼 질문은 보여 주기 전에 전제만 검사한다.
      // 대기를 줄이려고 두 검사를 함께 시작한다. 이름 검사에서 걸리면 전제 검사 한 번이 헛돈다.
      const [detected, premiseResult] = await Promise.all([
        detectTechs(this.as('leak'), { questionText: draft.text, userMentioned: input.userMentioned }),
        draft.assumption.axis !== 'none'
          ? checkPremise(this.as('premise'), { topic: input.topic, draft })
          : null,
      ]);
      usage.push(detected.usage);
      if (premiseResult) usage.push(premiseResult.usage);
      const techs = detected.data.techs;
      // 설계 6.3: premise는 가정 변경의 전제일 때만 허용한다. 가정 없는 질문의 premise는 해답으로 본다.
      const checked =
        draft.assumption.axis === 'none'
          ? techs.map((t) => (t.role === 'premise' ? { ...t, role: 'solution' } : t))
          : techs;
      const naming = checkNaming({
        techs: checked,
        userMentioned: input.userMentioned,
        avoid: input.avoidTechs,
      });
      premise = naming.ok && premiseResult ? premiseResult.data : null;
      attempts.push({ draft, naming, premise, techs });

      leak = !naming.ok;
      if (leak) {
        feedback.push(...namingFeedback(naming));
      } else if (premise && !premise.premiseOk) {
        feedback.push(
          ...(premise.problems.length > 0
            ? premise.problems.map((p) => p.problem)
            : [
                '질문 문장의 기술 전제가 틀렸다는 지적을 받았다. 전제로 쓴 기술 사실을 다시 확인한다.',
              ]),
        );
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
  async completeQuestion(input) {
    const written = await writeAnswerKey(this.as('answerKey'), input);
    const verified = await verifyAnswerKey(this.as('verify'), {
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

  async replyToClarification(input) {
    const usage = [];
    const feedback = [];
    // 질문에 이미 나온 기술은 다시 말해도 흘림이 아니다.
    const allowed = [...input.userMentioned, ...input.questionTechs.map((t) => t.name)];
    let reply = '';
    let leak = false;

    for (let i = 0; i <= this.config.maxRegenerations; i++) {
      const answered = await answerClarification(this.as('clarify'), { ...input, feedback });
      usage.push(answered.usage);
      reply = answered.data.reply;
      const detected = await detectTechs(this.as('leak'), { questionText: reply, userMentioned: allowed });
      usage.push(detected.usage);
      // 응답은 새 가정을 세우지 않으므로 premise도 해답으로 본다.
      const techs = detected.data.techs.map((t) =>
        t.role === 'premise' ? { ...t, role: 'solution' } : t,
      );
      const naming = checkNaming({ techs, userMentioned: allowed, avoid: input.avoidTechs });
      leak = !naming.ok;
      if (!leak) break;
      feedback.push(...namingFeedback(naming));
    }
    return { reply, leak, usage };
  }

  async pickJobRole(topic) {
    const { data, usage } = await pickJobRole(this.as('jobRole'), topic);
    return { role: data.role, usage };
  }

  // 모델이 없는 결함·질문·가정을 가리켜도 뒤 단계가 흔들리지 않게 그런 항목을 버리거나 비운다.
  async reviewTurn(input) {
    const { data, usage } = await reviewTurn(this.as('review'), input);
    // 범위 밖 index와, 같은 index의 둘째부터는 버린다. 뒤 단계가 index로 결함과 질문을 찾기 때문이다.
    const valid = (items, length) =>
      items.filter(
        (item, i) =>
          item.index >= 0 &&
          item.index < length &&
          items.findIndex((x) => x.index === item.index) === i,
      );
    const { sameAs } = data.assumption;
    return {
      review: {
        ...data,
        defects: valid(data.defects, input.analysis.defects.length),
        reactions: valid(data.reactions, input.followUps.length),
        assumption: {
          ...data.assumption,
          sameAs: input.knownAssumptions.some((a) => a.key === sameAs) ? sameAs : null,
        },
      },
      usage,
    };
  }

  async handleAnswer(input) {
    const asker = input.panel.find((m) => m.id === input.askedBy);
    if (!asker) throw new Error(`패널에 없는 면접관이다: ${input.askedBy}`);

    const { data: analysis, usage } = await analyzeAnswer(this.as('analyze'), {
      topic: input.topic,
      question: input.question,
      answer: input.answer,
      userMentioned: input.userMentioned,
    });
    // 이미 말한 기술(주제 기술 포함)에 대한 모름은 넘어가지 않는다. 분석이 프롬프트를 어겨 넣어도 여기서 거른다.
    const said = new Set(input.userMentioned.map(normalize));
    const unsaid = (techs = []) => techs.filter((t) => !said.has(normalize(t)));
    const askedUnknown = unsaid(analysis.unknownTechs);
    // 스스로 꺼낸 모름은 다시 묻지 않을 기술로만 쌓고, 넘어가지 않는다. 질문이 그 기술에 기대지 않아 답은 분석할 수 있다.
    const unknownTechs = [...askedUnknown];
    for (const t of unsaid(analysis.selfUnknownTechs))
      if (!unknownTechs.some((u) => normalize(u) === normalize(t))) unknownTechs.push(t);
    // 분석이 모른다고 한 기술을 mentionedTechs에도 넣었으면 뺀다. 면접관이 먼저 꺼내도 되는 기술이 되기 때문이다.
    const unknown = new Set(unknownTechs.map(normalize));
    const mentioned = analysis.mentionedTechs.filter((t) => !unknown.has(normalize(t)));
    const userMentioned = [...new Set([...input.userMentioned, ...mentioned])];
    if (analysis.kind === 'clarify')
      return { analysis, pick: null, userMentioned, usage: [usage], unknownTechs };

    const questionAxis = input.question.assumption.axis;
    const axis = OWNABLE_AXES.find((a) => a === questionAxis) ?? ROLES[asker.role].axes[0];
    if (askedUnknown.length > 0) {
      // shortcut: 같은 면접관이 이어 묻고 연속 상한은 보지 않는다, 계획 2에서 턴 진행 규칙과 함께 정리
      const note = `지원자가 ${askedUnknown.join(', ')}에 대해 모른다고 했다. 써 보지 않은 기술을 모르는 것은 결함이 아니라서 결함 없음으로 두었고, 아래는 판정이 아니라 이번 질문이 지킬 조건이다. 그 기술의 이름을 다시 말하지 않고 "그 부분은 알겠습니다"처럼 받은 뒤 다음으로 넘어간다. 그 기술을 설명하지 않고, 이번 질문에서는 가정을 세우는 전제로도 쓰지 않는다. 설명하면 면접 중에 가르치게 되고, 다시 꺼내면 지원자가 답할 수 없는 것을 또 묻게 되기 때문이다.`;
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
    const defects =
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
