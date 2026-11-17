import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getPendingTopics, listInterviews, startInterview } from '@/api';
import { StatsPanel } from '@/components/stats-panel';
import { describeApiError } from '@/lib/api-error';
import type { InterviewListItem } from '@/lib/decode';

const LIMITS = ['기본값', '4', '6', '8', '10'];

export function StartScreen(props: {
  notice: string | null;
  onOpen: (id: string) => void;
  onReview: (id: string) => void;
}) {
  const [topic, setTopic] = useState('');
  const [limit, setLimit] = useState(LIMITS[0]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<InterviewListItem[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const sending = useRef(false); // state는 다음 렌더에야 바뀌므로, 두 번 누름은 ref로 막는다.

  useEffect(() => {
    listInterviews().then(setItems, () => setError('최근 면접을 불러오지 못했습니다.'));
    getPendingTopics().then(setTopics, () => setError('다시 연습할 주제를 불러오지 못했습니다.'));
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (sending.current || topic.trim() === '') return;
    sending.current = true;
    setStarting(true);
    setError(null);
    startInterview(topic, limit === LIMITS[0] ? undefined : Number(limit)).then(
      (view) => props.onOpen(view.id),
      (err: unknown) => {
        sending.current = false;
        setStarting(false);
        setError(describeApiError(err).text);
      },
    );
  };

  const shown = error ?? props.notice;
  return (
    <>
      <form onSubmit={submit} className="mb-8 space-y-4">
        <div>
          <label htmlFor="topic" className="mb-1 block font-medium">
            주제
          </label>
          <input
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={200}
            disabled={starting}
            placeholder="예: 주문 시스템의 재고 동시성, 캐시 일관성"
            className="min-h-11 w-full rounded border border-line bg-card px-3 text-base"
          />
        </div>
        <div>
          <label htmlFor="limit" className="mb-1 block font-medium">
            질문 수
          </label>
          <select
            id="limit"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            disabled={starting}
            className="min-h-11 rounded border border-line bg-card px-3 text-base"
          >
            {LIMITS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={starting || topic.trim() === ''}
          className="min-h-11 rounded bg-accent px-6 text-base font-medium text-accent-ink disabled:opacity-50"
        >
          면접 시작
        </button>
        <p role="status" aria-live="polite">
          {starting && '면접관을 모으고 첫 질문을 준비하고 있습니다. 1분쯤 걸릴 수 있습니다.'}
        </p>
        {shown !== null && (
          <p role="alert" className="font-medium text-danger">
            오류: {shown}
          </p>
        )}
      </form>

      {topics.length > 0 && (
        <section aria-labelledby="pending-topics" className="mb-8">
          <h2 id="pending-topics" className="mb-2 text-lg font-semibold">
            다시 연습할 가정이 남은 주제
          </h2>
          <ul className="flex flex-wrap gap-2">
            {topics.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  disabled={starting}
                  className="min-h-11 break-words rounded border border-line bg-card px-4 text-left"
                  onClick={() => setTopic(t)}
                >
                  {t}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-2 text-lg font-semibold">
          최근 면접
        </h2>
        {items.length === 0 ? (
          <p className="text-muted">아직 면접이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => {
              const done = it.status === 'finished';
              return (
                <li
                  key={it.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-card p-3"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">{it.topic}</p>
                    <p className="text-sm text-muted">
                      {new Date(it.createdAt).toLocaleString('ko-KR')} · {done ? '끝남' : '진행 중'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="min-h-11 rounded border border-line px-4"
                    onClick={() => (done ? props.onReview(it.id) : props.onOpen(it.id))}
                  >
                    {done ? '복기 보기' : '이어 하기'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <StatsPanel />
    </>
  );
}
