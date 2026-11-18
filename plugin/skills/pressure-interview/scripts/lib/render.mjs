// 앱의 복기 화면(frontend/web/components/review-screen.tsx)과 추이 화면이 보이던 것을 Markdown으로 쓴다. 답 시작 시간은 싣지 않는다.

const RESULT = { well: '잘 답함', wobbly: '흔들림', wrong: '틀림', none: '해당 없음' };
const DEFECT_VERDICT = { valid: '맞는 판정', misjudged: '오판' };
const REACTION_VERDICT = {
  valid_point: '맞는 지적',
  misjudgment: '오판',
  intended_test: '의도된 확신 시험',
  deepening: '더 깊이 물음',
};
const SURPRISE = { expected: '예상했음', unexpected: '예상 밖' };

const pad2 = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const minute = (d) => `${day(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const seconds = (ms) => (ms / 1000).toFixed(1);
// 표의 칸에는 줄바꿈과 |가 들어가면 안 된다.
const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const row = (values) => `| ${values.map(cell).join(' | ')} |`;
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)];
const list = (items, empty = '없음') => (items.length === 0 ? [empty] : items.map((s) => `- ${s}`));
const intentText = (i) => `${i.group} · ${i.name}`;
const withNote = (text, note) => (note ? `${text} · ${note}` : text);

export const sayQuestion = (view) =>
  `**질문 ${view.open.seq}/${view.questionLimit} · ${view.open.roleName} 면접관**\n\n${view.open.text}`;

export const sayClarify = (view, reply) => `**${view.open.roleName} 면접관**\n\n${reply}`;

/** calls.jsonl의 호출 줄(type이 없는 줄)을 종류와 모델로 묶는다. 걸린 시간은 엔진이 잰 wall_ms의 합이다. */
export function summarizeCalls(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.type !== undefined) continue;
    const id = `${r.kind}\n${r.model}`;
    let g = groups.get(id);
    if (!g) {
      g = { kind: r.kind, model: r.model, calls: 0, inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, durationMs: 0 };
      groups.set(id, g);
    }
    g.calls += 1;
    g.inputTokens += r.input_tokens ?? 0;
    g.cacheCreationTokens += r.cache_creation_input_tokens ?? 0;
    g.cacheReadTokens += r.cache_read_input_tokens ?? 0;
    g.outputTokens += r.output_tokens ?? 0;
    g.durationMs += r.wall_ms ?? 0;
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...groups.values()].sort((a, b) => cmp(a.kind, b.kind) || cmp(a.model, b.model));
}

function turnSection(t) {
  const r = t.review;
  const key = t.answerKey;
  const out = [`## 질문 ${t.seq} · ${t.interviewer.roleName}(${t.interviewer.temperamentName})${t.addOn ? ' · 덧붙이는 질문' : ''}`, '', t.text, ''];

  if (t.clarifications.length > 0) {
    out.push('### 되묻기', '');
    for (const c of t.clarifications) {
      out.push(`- 나의 되묻기: ${c.ask}`, `  - 면접관: ${c.reply}`);
      if (c.leak) out.push('  - 이 응답에서 해답 기술이 나왔을 수 있음');
    }
    out.push('');
  }

  out.push('### 내 답', '', t.answer, '');

  const { reactionIntent, defect } = t.cause;
  out.push(
    '### 질문 의도',
    '',
    intentText(t.questionIntent),
    '',
    `이 질문이 나온 까닭: ${reactionIntent === null ? '반응 의도 없음' : intentText(reactionIntent)}` +
      (defect === null ? '' : ` · 맡은 결함: ${defect.typeName}(${defect.axisName})${defect.note ? ` ${defect.note}` : ''}`),
    '',
  );

  out.push('### 내 답이 의도를 향했는가', '', withNote(r.intent.aimed ? '향했음' : '빗나감', r.intent.note), '');

  out.push(
    '### 면접 중 판정의 재검사',
    '',
    ...list(
      r.defects.map((d) => {
        const a = t.analysis[d.index];
        return withNote(`${a.typeName}(${a.axisName}): ${DEFECT_VERDICT[d.verdict]}`, d.note);
      }),
      '분석이 적은 결함이 없습니다.',
    ),
    '',
    '### 이 답에서 나온 질문',
    '',
    ...list(
      r.reactions.map((x) => {
        const f = t.followUps[x.index];
        const what = `질문 ${f.seq}(${f.roleName}, ${intentText(f.reactionIntent)}${f.addOn ? ', 덧붙이는 질문' : ''})`;
        return withNote(`${what}: ${REACTION_VERDICT[x.verdict]}`, x.note);
      }),
      '이 답에서 나온 질문이 없습니다.',
    ),
    '',
  );

  out.push('### 바뀐 가정', '');
  if (t.assumption === null) out.push('가정을 바꾸지 않은 질문입니다.', '');
  else {
    const { result, userResult, note } = r.assumption;
    out.push(
      `${t.assumption.axisName}: ${t.assumption.statement}`,
      '',
      withNote(`결과: ${RESULT[userResult ?? result]}${userResult !== undefined ? ' (직접 고침)' : ''}`, note),
      '',
    );
  }

  out.push(
    '### 정답지',
    '',
    ...(t.answerKeyCorrected ? ['정답지 수정됨: 검증이 정답지를 고쳤습니다.', ''] : []),
    '사라지는 차이',
    '',
    ...list(key.vanishing),
    '',
    '남는 차이',
    '',
    ...list(key.remaining),
    '',
    '대안 기술과 특징',
    '',
    ...list(key.alternatives.map((a) => `${a.name}: ${a.traits}`)),
    '',
    '기대하는 답의 핵심',
    '',
    ...list(key.keyPoints),
    '',
  );
  if (r.keyProblems.length > 0) out.push('### 복기가 정답지에서 찾은 문제', '', ...list(r.keyProblems), '');

  const flags = [
    t.leakFlag && '흘림 표시: 질문에서 해답 기술이 나왔을 수 있음',
    t.premiseFlag && '전제 표시: 질문의 전제가 틀렸을 수 있음',
  ].filter(Boolean);
  if (flags.length > 0) out.push('### 표시', '', ...list(flags), '');

  out.push('### 예상 표시', '', SURPRISE[t.surprise] ?? '표시 없음', '');
  return out;
}

/** reviewView는 toReviewView의 결과다. 숨긴 값(의도·정답지·판정)을 모두 싣는다. */
export function renderReview(reviewView, { usage, waits }) {
  const v = reviewView;
  const out = [`# 복기: ${v.topic} (${minute(new Date(v.createdAt))})`, '', '## 가정별 결과', ''];
  if (v.assumptions.length === 0) out.push('가정별 결과가 없습니다.');
  else out.push(...table(['축', '가정', '결과', '질문'], v.assumptions.map((a) => [a.axisName, a.statement, RESULT[a.result], a.turnSeq])));
  out.push('');

  for (const t of v.turns) out.push(...turnSection(t));

  if (v.skippedAnswers > 0) out.push(`분석되지 않아 복기에서 빠진 답 ${v.skippedAnswers}개`, '');

  out.push('## 호출 기록', '');
  if (usage.length === 0) out.push('기록된 호출이 없습니다.');
  else
    out.push(
      ...table(
        ['종류', '모델', '횟수', '입력 토큰(캐시 제외)', '캐시 쓰기 토큰', '캐시 읽기 토큰', '출력 토큰', '걸린 시간(초)'],
        usage.map((u) => [u.kind, u.model, u.calls, u.inputTokens, u.cacheCreationTokens, u.cacheReadTokens, u.outputTokens, seconds(u.durationMs)]),
      ),
    );
  out.push('', '## 답 뒤 대기', '', '답 명령이 시작해 다음 질문을 낼 때까지 엔진이 잰 시간입니다.', '');
  if (waits.length === 0) out.push('기록이 없습니다.');
  else out.push(...table(['질문', '초'], waits.map((w) => [w.seq, seconds(w.wall_ms)])));
  out.push('');
  return out.join('\n');
}

export function renderStats({ improved, sessions, pendingTopics }) {
  const out = ['# 면접 추이', '', `흔들림이나 틀림에서 잘 답함으로 바뀐 가정: ${improved}개`, '', '## 최근 끝난 면접', ''];
  if (sessions.length === 0) out.push('끝난 면접이 없습니다.');
  else
    out.push(
      ...table(
        ['날짜', '주제', '예상 밖 비율'],
        sessions.map((s) => [day(new Date(s.date)), s.topic, s.unexpectedRatio === null ? '표시 없음' : `${Math.round(s.unexpectedRatio * 100)}%`]),
      ),
    );
  out.push('', '## 다시 연습할 주제', '', ...list(pendingTopics, '다시 연습할 가정이 남은 주제가 없습니다.'), '');
  return out.join('\n');
}
