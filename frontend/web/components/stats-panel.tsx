import { useEffect, useState } from 'react';
import { getStats } from '@/api';
import { describeApiError } from '@/lib/api-error';
import type { Stats } from '@/lib/review-decode';

export const seconds = (ms: number | null) =>
  ms === null ? '기록 없음' : `${(ms / 1000).toFixed(1)}초`;
const percent = (r: number | null) => (r === null ? '표시 없음' : `${Math.round(r * 100)}%`);

// 목표치는 보여 주지 않는다. 지난 면접과 견주는 숫자만 둔다.
// version이 바뀌면 다시 읽는다. 복기 화면에서 예상 표시나 가정 결과를 고치면 추이가 달라지기 때문이다.
export function StatsPanel(props: { version?: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 표시를 빠르게 두 번 고치면 늦게 온 첫 응답이 새 값을 덮어쓰지 않게, 이 effect의 응답만 반영한다.
    let alive = true;
    setError(null);
    getStats().then(
      (s) => {
        if (alive) setStats(s);
      },
      (e: unknown) => {
        if (alive) setError(describeApiError(e).text);
      },
    );
    return () => {
      alive = false;
    };
  }, [props.version]);

  return (
    <section aria-labelledby="stats-title" className="mt-8">
      <h2 id="stats-title" className="mb-2 text-lg font-semibold">
        추이
      </h2>
      {error !== null && (
        <p role="alert" className="font-medium text-danger">
          오류: {error}
        </p>
      )}
      {stats === null ? (
        error === null && <p role="status">불러오는 중…</p>
      ) : (
        <>
          <p className="mb-2">흔들림에서 잘 답함으로 바뀐 가정: {stats.improved}개</p>
          {stats.sessions.length === 0 ? (
            <p className="text-muted">끝난 면접이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="p-2">날짜</th>
                    <th className="p-2">주제</th>
                    <th className="p-2">답 시작 시간 중앙값</th>
                    <th className="p-2">예상 밖 비율</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.sessions.map((s) => (
                    <tr key={s.id} className="border-b border-line">
                      <td className="p-2">{new Date(s.date).toLocaleDateString('ko-KR')}</td>
                      <td className="break-words p-2">{s.topic}</td>
                      <td className="p-2">{seconds(s.medianAnswerStartMs)}</td>
                      <td className="p-2">{percent(s.unexpectedRatio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
