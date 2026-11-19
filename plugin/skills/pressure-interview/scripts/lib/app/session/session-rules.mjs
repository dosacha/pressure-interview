// 서버판 src/session/session-rules.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
                                                                  
             
            
              
                   
       
             
                            

export const CLOSING_TEXT = '준비한 질문은 여기까지입니다. 수고하셨습니다.';

export function composePanel(jobRole           , rng              )                {
  const t                  = ['persistent', 'helper', 'shaker'];
  for (let i = 2; i >= 1; i--) {
    const j = Math.floor(rng() * (i + 1));
    [t[i], t[j]] = [t[j], t[i]];
  }
  return [
    { id: 'p1', role: jobRole, temperament: t[0] },
    { id: 'p2', role: 'textbook', temperament: t[1] },
    { id: 'p3', role: 'scenario', temperament: t[2] },
  ];
}
