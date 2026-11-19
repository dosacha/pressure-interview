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

// 마무리도 이 면접관이 한다.
export function pickOpener(panel               , rng              )              {
  return panel[Math.floor(rng() * panel.length)];
}

// 절반을 넘도록 가정 변경 질문이 없으면 정체성 비교 축을 지정해 한 번은 나오게 한다.
export function chooseTargetAxis(s   
                  
                        
                                      
 )                {
  if (s.nextSeq === 1) return null;
  const hasAssumption = s.assumptionAxes.some((a) => a !== 'none');
  return !hasAssumption && s.nextSeq > Math.ceil(s.questionLimit / 2) ? 'identity_swap' : null;
}

export function nextAsker(input   
                     
             
                                   
 )                                                                                                {
  const { lastTurnId, pick, pending } = input;
  if (pending && pick.defect.type !== 'wrong' && pick.reactionIntent !== 'B11') {
    return { choice: pending.choice, addOn: true, causeTurnId: pending.causeTurnId, pending: null };
  }
  return {
    choice: {
      interviewerId: pick.interviewerId,
      defect: pick.defect,
      reactionIntent: pick.reactionIntent,
    },
    addOn: false,
    causeTurnId: lastTurnId,
    pending: pick.secondary ? { choice: pick.secondary, causeTurnId: lastTurnId } : null,
  };
}
