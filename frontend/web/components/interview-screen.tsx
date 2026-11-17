import { useEffect, useRef, useState } from 'react';
import { advance, finish, getInterview, sendAnswer } from '@/api';
import { ApiError, describeApiError } from '@/lib/api-error';
import type { InterviewView } from '@/lib/decode';
import { shouldClearDraft } from '@/lib/draft';
import { createFirstInputTimer } from '@/lib/first-input-timer';

const BUTTON = 'min-h-11 rounded px-6 text-base disabled:opacity-50';

export function InterviewScreen(props: {
  id: string;
  onReview: () => void;
  onMissing: () => void;
  onExit: () => void;
}) {
  const { id, onMissing } = props;
  const [view, setView] = useState<InterviewView | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false); // 같은 요청이 두 번 나가지 않게 한다. 호출마다 과금된다.
  const timer = useRef(createFirstInputTimer(Date.now));
  const openTurn = view?.pending === 'answer' ? view.turns.at(-1) : undefined;
  const openTurnId = openTurn?.id;
  const clarifications = openTurn?.clarifications.length ?? 0;
  const prevOpen = useRef<{ turnId: string | null; clarifications: number }>({
    turnId: null,
    clarifications: 0,
  });

  const refresh = () =>
    getInterview(id).then(setView, (e: unknown) => {
      if (e instanceof ApiError && e.code === 'NOT_FOUND') onMissing();
      else setError(describeApiError(e).text);
    });

  useEffect(() => {
    void refresh();
  }, []); // id가 바뀌면 화면이 새로 만들어진다(key)

  useEffect(() => {
    if (openTurnId !== undefined) timer.current.shown();
  }, [openTurnId]);

  // 앞 질문에 쓰던 답이 새 질문 칸에 남아 잘못 보내지면 과금되므로, 턴이 바뀌거나 되묻기 응답이 붙으면 비운다.
  useEffect(() => {
    const next = { turnId: openTurnId ?? null, clarifications };
    if (shouldClearDraft(prevOpen.current, next)) setDraft('');
    prevOpen.current = next;
  }, [openTurnId, clarifications]);

  // 모델을 부르는 요청은 한 번에 하나만 보낸다. 실패하면 서버 상태를 다시 읽어 버튼을 맞춘다.
  const run = async (call: () => Promise<InterviewView>, onDone?: () => void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      setView(await call());
      onDone?.();
    } catch (e) {
      setError(describeApiError(e).text);
      // reload 값과 상관없이 늘 다시 읽는다: GET이라 과금이 없고, 답이 저장된 뒤 실패했는지는 읽어야 안다.
      await refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (view === null)
    return error === null ? (
      <p role="status">불러오는 중…</p>
    ) : (
      <p role="alert" className="font-medium text-danger">
        오류: {error}
      </p>
    );

  const nameOf = (who: string) => view.panel.find((m) => m.id === who)?.roleName ?? '면접관';
  const send = () => {
    if (openTurnId === undefined || draft.trim() === '') return;
    const startMs = timer.current.value();
    void run(
      () => sendAnswer(view.id, openTurnId, draft, startMs),
      () => setDraft(''),
    );
  };
  const confirmFinish = () => {
    if (window.confirm('여기서 면접을 끝낼까요?')) void run(() => finish(view.id));
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="break-words text-lg font-semibold">{view.topic}</h2>
        <p className="text-sm text-muted">
          면접관: {view.panel.map((m) => m.roleName).join(', ')} · 질문 {view.turns.length}/
          {view.questionLimit} · {view.status === 'finished' ? '끝남' : '진행 중'}
        </p>
      </header>

      <ol className="space-y-5">
        {view.turns.map((t) => (
          <li key={t.id} className="space-y-2">
            <div className="rounded border border-line bg-card p-3">
              <p className="mb-1 text-sm font-medium text-muted">
                {nameOf(t.interviewerId)}
                {t.addOn && ' · 덧붙이는 질문'}
              </p>
              <p className="break-words whitespace-pre-wrap">{t.text}</p>
            </div>
            {t.clarifications.map((c, i) => (
              <div key={i} className="ml-4 space-y-1 text-sm">
                <p className="break-words whitespace-pre-wrap">나의 되묻기: {c.ask}</p>
                <p className="break-words whitespace-pre-wrap text-muted">면접관: {c.reply}</p>
              </div>
            ))}
            {t.answer !== null && (
              <div className="ml-4 rounded bg-line/40 p-3">
                <p className="mb-1 text-sm font-medium text-muted">내 답</p>
                <p className="break-words whitespace-pre-wrap">{t.answer}</p>
              </div>
            )}
          </li>
        ))}
      </ol>

      <p role="status" aria-live="polite" className="font-medium">
        {busy && '면접관이 답을 듣고 있습니다…'}
      </p>
      {error !== null && (
        <p role="alert" className="font-medium text-danger">
          오류: {error}
        </p>
      )}

      {view.status === 'finished' ? (
        <section className="space-y-3">
          <p className="font-medium">
            {nameOf(view.closing?.interviewerId ?? '')}: {view.closing?.text}
          </p>
          <button
            type="button"
            className={`${BUTTON} bg-accent text-accent-ink`}
            onClick={props.onReview}
          >
            복기 보기
          </button>
        </section>
      ) : (
        <section className="space-y-3">
          {view.pending === 'retry' ? (
            <button
              type="button"
              disabled={busy}
              className={`${BUTTON} bg-accent text-accent-ink`}
              onClick={() => void run(() => advance(view.id))}
            >
              다시 시도
            </button>
          ) : (
            <>
              <p className="text-sm text-muted">
                답 첫머리에 질문의 의도를 한 줄로 짚어 보세요. 조건이 궁금하면 되물어도 됩니다.
              </p>
              <label htmlFor="answer" className="block font-medium">
                내 답
              </label>
              <textarea
                id="answer"
                value={draft}
                rows={6}
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
                onInput={() => timer.current.input()}
                className="min-h-11 w-full rounded border border-line bg-card p-3 text-base"
              />
              <button
                type="button"
                disabled={busy || draft.trim() === ''}
                className={`${BUTTON} bg-accent text-accent-ink`}
                onClick={send}
              >
                보내기
              </button>
            </>
          )}
          <div>
            <button
              type="button"
              disabled={busy}
              className={`${BUTTON} border border-line bg-card`}
              onClick={confirmFinish}
            >
              여기서 끝내기
            </button>
          </div>
        </section>
      )}
      <button type="button" className="min-h-11 text-muted underline" onClick={props.onExit}>
        처음으로
      </button>
    </div>
  );
}
