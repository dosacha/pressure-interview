import { useEffect, useState } from 'react';
import { InterviewScreen } from '@/components/interview-screen';
import { StartScreen } from '@/components/start-screen';

type Screen =
  { screen: 'start' } | { screen: 'interview'; id: string } | { screen: 'review'; id: string };

const HASH = /^#interview\/([0-9a-f-]{36})$/i;

// 라우터 없이 화면 상태만 둔다. 면접 중인 id만 hash에 적어 새로고침해도 돌아온다.
function initialScreen(): Screen {
  const id = HASH.exec(location.hash)?.[1];
  return id === undefined ? { screen: 'start' } : { screen: 'interview', id };
}

const MISSING = '면접을 찾을 수 없습니다.';
// 꼴이 틀린 주소는 없는 id와 같게 다룬다: 문장을 보이고 hash를 비운다.
const badHash = () => location.hash.startsWith('#interview/') && !HASH.test(location.hash);

export function App() {
  const [state, setState] = useState<Screen>(initialScreen);
  const [notice, setNotice] = useState<string | null>(() => (badHash() ? MISSING : null));
  useEffect(() => {
    if (badHash()) history.replaceState(null, '', '#');
  }, []);

  const go = (next: Screen, message: string | null = null) => {
    history.replaceState(null, '', next.screen === 'interview' ? `#interview/${next.id}` : '#');
    setNotice(message);
    setState(next);
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-xl font-bold">압박 면접 연습</h1>
      {state.screen === 'start' && (
        <StartScreen
          notice={notice}
          onOpen={(id) => go({ screen: 'interview', id })}
          onReview={(id) => go({ screen: 'review', id })}
        />
      )}
      {state.screen === 'interview' && (
        <InterviewScreen
          key={state.id}
          id={state.id}
          onReview={() => go({ screen: 'review', id: state.id })}
          onMissing={() => go({ screen: 'start' }, MISSING)}
          onExit={() => go({ screen: 'start' })}
        />
      )}
      {state.screen === 'review' && (
        <section aria-labelledby="review-title">
          <h2 id="review-title" className="mb-2 text-lg font-semibold">
            복기
          </h2>
          <p className="mb-4">복기는 아직 준비 중입니다.</p>
          <button
            type="button"
            className="min-h-11 rounded border border-line bg-card px-4"
            onClick={() => go({ screen: 'start' })}
          >
            처음으로
          </button>
        </section>
      )}
    </main>
  );
}
