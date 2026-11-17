import { useEffect, useState } from 'react';
import { InterviewScreen } from '@/components/interview-screen';
import { ReviewScreen } from '@/components/review-screen';
import { StartScreen } from '@/components/start-screen';

type Screen =
  { screen: 'start' } | { screen: 'interview'; id: string } | { screen: 'review'; id: string };

const HASH = /^#(interview|review)\/([0-9a-f-]{36})$/i;

// 라우터 없이 화면 상태만 둔다. 면접과 복기의 id를 hash에 적어 새로고침해도 돌아온다.
function initialScreen(): Screen {
  const m = HASH.exec(location.hash);
  if (m === null) return { screen: 'start' };
  return { screen: m[1].toLowerCase() === 'review' ? 'review' : 'interview', id: m[2] };
}

const MISSING = '면접을 찾을 수 없습니다.';
// 꼴이 틀린 주소는 없는 id와 같게 다룬다: 문장을 보이고 hash를 비운다.
const badHash = () => /^#(interview|review)\//i.test(location.hash) && !HASH.test(location.hash);

export function App() {
  const [state, setState] = useState<Screen>(initialScreen);
  const [notice, setNotice] = useState<string | null>(() => (badHash() ? MISSING : null));
  useEffect(() => {
    if (badHash()) history.replaceState(null, '', '#');
    // 주소창에서 hash만 바꾸면 새로 불러오지 않으므로 여기서 화면을 맞춘다. replaceState는 이 사건을 내지 않는다.
    const onHash = () => {
      const bad = badHash();
      if (bad) history.replaceState(null, '', '#');
      setNotice(bad ? MISSING : null);
      setState(initialScreen());
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const go = (next: Screen, message: string | null = null) => {
    history.replaceState(null, '', next.screen === 'start' ? '#' : `#${next.screen}/${next.id}`);
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
        <ReviewScreen key={state.id} id={state.id} onExit={() => go({ screen: 'start' })} />
      )}
    </main>
  );
}
