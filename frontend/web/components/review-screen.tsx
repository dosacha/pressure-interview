import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getReview, patchTurn, startReview } from '@/api';
import { describeApiError } from '@/lib/api-error';
import { pollUntil } from '@/lib/poll';
import type { AssumptionResult, ReviewTurnView, ReviewView } from '@/lib/review-decode';
import { seconds, StatsPanel } from '@/components/stats-panel';

const BUTTON = 'min-h-11 rounded px-4 text-base disabled:opacity-50';
const RESULT_LABEL: Record<AssumptionResult, string> = {
  well: '잘 답함',
  wobbly: '흔들림',
  wrong: '틀림',
};
const DEFECT_VERDICT = { valid: '맞는 지적', misjudged: '오판' } as const;
const REACTION_VERDICT = {
  valid_point: '맞는 지적',
  misjudgment: '오판',
  intended_test: '의도된 확신 시험',
} as const;
const RESULTS: AssumptionResult[] = ['well', 'wobbly', 'wrong'];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const intentText = (i: { group: string; name: string }) => `${i.group} · ${i.name}`;

function Part(props: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold text-muted">{props.title}</h4>
      {props.children}
    </div>
  );
}

function List(props: { items: string[]; empty: string }) {
  if (props.items.length === 0) return <p className="text-sm text-muted">{props.empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {props.items.map((s, i) => (
        <li key={i} className="break-words">
          {s}
        </li>
      ))}
    </ul>
  );
}

function TurnCard(props: {
  turn: ReviewTurnView;
  busy: boolean;
  onPatch: (patch: {
    surprise?: 'expected' | 'unexpected';
    assumptionResult?: AssumptionResult;
  }) => void;
}) {
  const { turn: t, busy, onPatch } = props;
  const r = t.review;
  const key = t.answerKey;
  const flags = [
    t.answerKeyCorrected && '정답지 수정됨',
    t.leakFlag && '흘림 플래그: 질문에서 해답 기술이 나왔을 수 있음',
    t.premiseFlag && '전제 오류 플래그: 질문의 전제가 틀렸을 수 있음',
  ].filter((f) => f !== false);
  const shownResult = r && (r.assumption.userResult ?? r.assumption.result);

  return (
    <li className="space-y-4 rounded border border-line bg-card p-4">
      {/* 1. 질문과 누가 물었는지 */}
      <div>
        <h3 className="mb-1 text-sm font-medium text-muted">
          질문 {t.seq} · {t.interviewer.roleName}({t.interviewer.temperamentName})
          {t.addOn && ' · 덧붙이는 질문'}
        </h3>
        <p className="break-words whitespace-pre-wrap">{t.text}</p>
      </div>

      {/* 2. 내 답과 되묻기 */}
      <Part title="내 답">
        {t.clarifications.map((c, i) => (
          <div key={i} className="space-y-1 text-sm">
            <p className="break-words whitespace-pre-wrap">나의 되묻기: {c.ask}</p>
            <p className="break-words whitespace-pre-wrap text-muted">면접관: {c.reply}</p>
            {c.leak && (
              <p className="font-medium text-danger">이 응답에서 해답 기술이 나왔을 수 있음</p>
            )}
          </div>
        ))}
        <p className="break-words whitespace-pre-wrap">{t.answer}</p>
        <p className="text-sm text-muted">답 시작까지 걸린 시간: {seconds(t.answerStartMs)}</p>
      </Part>

      {/* 3. 질문 의도와 나온 까닭 */}
      <Part title="질문 의도">
        <p>{intentText(t.questionIntent)}</p>
        <p className="text-sm">
          이 질문이 나온 까닭:{' '}
          {t.cause.reactionIntent === null ? '반응 의도 없음' : intentText(t.cause.reactionIntent)}
          {t.cause.defect !== null &&
            ` · 맡은 결함: ${t.cause.defect.typeName}(${t.cause.defect.axisName})${t.cause.defect.note ? ` ${t.cause.defect.note}` : ''}`}
        </p>
      </Part>

      {r !== null && (
        <>
          {/* 4. 의도를 향했는지 */}
          <Part title="내 답이 의도를 향했는가">
            <p>
              {r.intent.aimed ? '향했음' : '벗어났음'}
              {r.intent.note && ` · ${r.intent.note}`}
            </p>
          </Part>

          {/* 5. 면접관 판정의 재검사 */}
          <Part title="면접관 판정의 재검사">
            <List
              empty="분석이 적은 결함이 없습니다."
              items={r.defects.map((d) => {
                const a = t.analysis[d.index];
                const what =
                  a === undefined ? `결함 ${d.index + 1}` : `${a.typeName}(${a.axisName})`;
                return `${what}: ${DEFECT_VERDICT[d.verdict]}${d.note ? ` · ${d.note}` : ''}`;
              })}
            />
            <List
              empty="이 답에서 나온 질문이 없습니다."
              items={r.reactions.map((x) => {
                const f = t.followUps[x.index];
                const what =
                  f === undefined
                    ? `이 답에서 나온 질문 ${x.index + 1}`
                    : `질문 ${f.seq}(${f.roleName}, ${intentText(f.reactionIntent)}${f.addOn ? ', 덧붙이는 질문' : ''})`;
                return `${what}: ${REACTION_VERDICT[x.verdict]}${x.note ? ` · ${x.note}` : ''}`;
              })}
            />
          </Part>
        </>
      )}

      {/* 6. 바뀐 가정과 차이 */}
      <Part title="바뀐 가정">
        <p className="break-words">
          {t.assumption === null
            ? '가정을 바꾸지 않은 질문입니다.'
            : `${t.assumption.axisName}: ${t.assumption.statement}`}
        </p>
        <p className="text-sm font-medium">사라진 차이</p>
        <List items={key.vanishing} empty="없음" />
        <p className="text-sm font-medium">남은 차이</p>
        <List items={key.remaining} empty="없음" />
      </Part>

      {/* 7. 숨은 정답지 */}
      <Part title="숨은 정답지">
        {flags.map((f) => (
          <p key={f} className="font-medium text-danger">
            {f}
          </p>
        ))}
        <p className="text-sm font-medium">대안 기술과 특징</p>
        <List items={key.alternatives.map((a) => `${a.name}: ${a.traits}`)} empty="없음" />
        <p className="text-sm font-medium">기대하는 답의 핵심</p>
        <List items={key.keyPoints} empty="없음" />
        {r !== null && r.keyProblems.length > 0 && (
          <>
            <p className="text-sm font-medium text-danger">복기가 정답지에서 찾은 문제</p>
            <List items={r.keyProblems} empty="없음" />
          </>
        )}
      </Part>

      {/* 8. 예상했음 / 예상 밖 */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="이 질문을 예상했는가">
        {(['expected', 'unexpected'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={t.surprise === s}
            disabled={busy}
            className={`${BUTTON} border border-line ${t.surprise === s ? 'bg-accent font-semibold text-accent-ink' : 'bg-card'}`}
            onClick={() => t.surprise !== s && onPatch({ surprise: s })}
          >
            {s === 'expected' ? '예상했음' : '예상 밖'}
            {t.surprise === s && ' (선택됨)'}
          </button>
        ))}
      </div>

      {/* 9. 가정 결과 고치기 */}
      {t.assumption !== null && r !== null && (
        <Part title="가정 결과">
          <p>
            {shownResult === 'none' || shownResult === null
              ? '판정 없음'
              : RESULT_LABEL[shownResult]}
            {r.assumption.userResult !== undefined && ' (직접 고침)'}
            {r.assumption.note && ` · ${r.assumption.note}`}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="가정 결과 고치기">
            {RESULTS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={shownResult === v}
                disabled={busy}
                className={`${BUTTON} border border-line ${shownResult === v ? 'bg-accent font-semibold text-accent-ink' : 'bg-card'}`}
                onClick={() => shownResult !== v && onPatch({ assumptionResult: v })}
              >
                {RESULT_LABEL[v]}
                {shownResult === v && ' (선택됨)'}
              </button>
            ))}
          </div>
        </Part>
      )}
    </li>
  );
}

export function ReviewScreen(props: { id: string; onExit: () => void }) {
  const { id } = props;
  const [view, setView] = useState<ReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statsVersion, setStatsVersion] = useState(0);
  const busyRef = useRef(false); // 복기 만들기는 과금되므로 두 번 누름을 ref로 막는다.
  const signal = useRef<AbortSignal | null>(null);

  // 처음 읽기와 만들기 뒤의 기다림이 같은 길을 쓴다. pending이면 끝날 때까지 3초마다 묻는다.
  const follow = async (s: AbortSignal, kick?: () => Promise<void>) => {
    try {
      await kick?.();
      await pollUntil(
        async () => {
          const v = await getReview(id);
          if (!s.aborted) setView(v);
          return v;
        },
        (v) => v.status !== 'pending',
        { intervalMs: 3000, sleep, signal: s },
      );
    } catch (e) {
      if (!s.aborted) setError(describeApiError(e).text);
    }
  };

  useEffect(() => {
    const ctl = new AbortController();
    signal.current = ctl.signal;
    void follow(ctl.signal);
    return () => ctl.abort(); // 화면을 떠나면 진행을 묻는 요청을 멈춘다.
  }, []); // id가 바뀌면 화면이 새로 만들어진다(key)

  const exclusive = async (work: () => Promise<void>) => {
    if (busyRef.current || signal.current === null) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const create = () =>
    void exclusive(async () => {
      await follow(signal.current!, () => startReview(id));
      setStatsVersion((n) => n + 1);
    });

  const patch = (turnId: string, body: Parameters<typeof patchTurn>[2]) =>
    void exclusive(async () => {
      try {
        setView(await patchTurn(id, turnId, body));
        setStatsVersion((n) => n + 1);
      } catch (e) {
        const { text, reload } = describeApiError(e);
        setError(text);
        if (reload) await follow(signal.current!);
      }
    });

  // 읽지 못했으면(진행 중인 면접의 409 등) 그 문장만 보인다. 숨긴 값은 하나도 그리지 않는다.
  if (view === null)
    return (
      <div className="space-y-4">
        {error === null ? (
          <p role="status">불러오는 중…</p>
        ) : (
          <p role="alert" className="font-medium text-danger">
            오류: {error}
          </p>
        )}
        <button
          type="button"
          className={`${BUTTON} border border-line bg-card`}
          onClick={props.onExit}
        >
          처음으로
        </button>
      </div>
    );

  return (
    <div className="space-y-6">
      <header>
        <h2 className="break-words text-lg font-semibold">복기: {view.topic}</h2>
        <p className="text-sm text-muted">{new Date(view.createdAt).toLocaleString('ko-KR')}</p>
      </header>

      <section aria-labelledby="assumptions-title">
        <h3 id="assumptions-title" className="mb-2 font-semibold">
          가정별 결과
        </h3>
        <List
          empty="아직 가정별 결과가 없습니다."
          items={view.assumptions.map(
            (a) => `${a.axisName}: ${a.statement} → ${RESULT_LABEL[a.result]} (질문 ${a.turnSeq})`,
          )}
        />
      </section>

      <section aria-labelledby="usage-title">
        <h3 id="usage-title" className="mb-2 font-semibold">
          사용량
        </h3>
        {view.usage.length === 0 ? (
          <p className="text-sm text-muted">기록된 호출이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="p-2">역할</th>
                  <th className="p-2">모델</th>
                  <th className="p-2">호출 수</th>
                  <th className="p-2">입력 토큰</th>
                  <th className="p-2">출력 토큰</th>
                  <th className="p-2">폴백 수</th>
                </tr>
              </thead>
              <tbody>
                {view.usage.map((u) => (
                  <tr key={`${u.role}/${u.model}`} className="border-b border-line">
                    <td className="p-2">{u.role}</td>
                    <td className="break-all p-2">{u.model}</td>
                    <td className="p-2">{u.calls}</td>
                    <td className="p-2">{u.inputTokens}</td>
                    <td className="p-2">{u.outputTokens}</td>
                    <td className="p-2">{u.fallbacks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view.skippedAnswers > 0 && (
          <p className="mt-2 text-sm">분석되지 않아 복기에서 빠진 답 {view.skippedAnswers}개</p>
        )}
      </section>

      <p role="status" aria-live="polite" className="font-medium">
        {view.status === 'pending' &&
          `복기를 만들고 있습니다 (${view.progress.done}/${view.progress.total})`}
      </p>
      {error !== null && (
        <p role="alert" className="font-medium text-danger">
          오류: {error}
        </p>
      )}

      {view.status === 'none' && (
        <section className="space-y-3">
          <p>
            {view.error === null
              ? '복기를 만들면 질문마다 재검사 호출이 나갑니다(과금).'
              : view.error === 'MEMORY_SYNC_FAILED'
                ? '복기는 만들었지만 기억에 반영하지 못했습니다. 다시 만들기를 누르면 반영만 다시 합니다(추가 과금 없음).'
                : '일부 질문의 복기를 만들지 못했습니다. 다시 만들기를 누르면 빠진 질문만 다시 만듭니다.'}
          </p>
          <button
            type="button"
            disabled={busy}
            className={`${BUTTON} bg-accent text-accent-ink`}
            onClick={create}
          >
            {view.error === null ? '복기 만들기' : '다시 만들기'}
          </button>
        </section>
      )}

      {view.status === 'ready' && (
        <ol className="space-y-5">
          {view.turns.map((t) => (
            <TurnCard key={t.id} turn={t} busy={busy} onPatch={(p) => patch(t.id, p)} />
          ))}
        </ol>
      )}

      <StatsPanel version={statsVersion} />
      <button type="button" className="min-h-11 text-muted underline" onClick={props.onExit}>
        처음으로
      </button>
    </div>
  );
}
