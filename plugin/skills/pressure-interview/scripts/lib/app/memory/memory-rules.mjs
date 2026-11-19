// 서버판 src/memory/memory-rules.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
                                                   
                                                                                          
                                                                      
                                                                   

                                   
                          
               
                    
                           
                                             
                    
             
 

                     
                
                                                                  
  

/** 한 세션의 턴에서 가정을 바꾼 질문을 같은 가정끼리 묶는다. 묶음의 결과는 마지막 턴의 것이다. */
export function foldAssumptions(turns            , recordIds          )                     {
  const groups                                                   = [];
  const groupOfTurn = new Map                                 ();
  const known = new Set(recordIds);
  const reviewed = turns
    .filter(
      (t) =>
        t.question.assumption.axis !== 'none' &&
        t.review !== null &&
        (t.review.assumption.userResult ?? t.review.assumption.result) !== 'none' &&
        // 답한 턴만 복기되므로 answeredAt이 없는 턴은 없어야 한다. 있으면 만남의 시각을 정할 수 없어 뺀다.
        t.answeredAt !== null,
    )
    .sort((a, b) => a.seq - b.seq);
  for (const t of reviewed) {
    const sameAs = t.review .assumption.sameAs;
    let group = sameAs?.startsWith('turn:') ? groupOfTurn.get(sameAs.slice(5)) : undefined;
    if (!group && sameAs !== null && known.has(sameAs)) {
      group = groups.find((g) => g.recordId === sameAs);
      if (!group) groups.push((group = { recordId: sameAs, turns: [] }));
    }
    if (!group) groups.push((group = { recordId: null, turns: [] }));
    group.turns.push(t);
    groupOfTurn.set(t.id, group);
  }
  return groups.map(({ recordId, turns: grouped }) => {
    const [first, last] = [grouped[0], grouped[grouped.length - 1]];
    const { result, userResult } = last.review .assumption;
    return {
      recordId,
      axis: first.question.assumption.axis          ,
      statement: first.question.assumption.statement,
      result: userResult ?? (result                    ),
      surprise: last.surprise,
      turnIds: grouped.map((t) => t.id),
      at: last.answeredAt .toISOString(),
    };
  });
}

const lastEncounter = (r                  ) => r.encounters.at(-1);
const recentFirst = (a                  , b                  ) =>
  b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
const isReissue = (r                  , now      , hours        ) =>
  (r.status === 'wobbly' || r.status === 'wrong') &&
  now.getTime() - r.lastSeenAt.getTime() >= hours * 3600_000;
const ref = (r                  )                => ({ axis: r.axis, statement: r.statement });

/** 질문 프롬프트에 싣는 기억. */
export function selectMemory(
  records                    ,
  now      ,
  reissueAfterHours        ,
)                 {
  // shortcut: 프롬프트 길이 때문에 상한을 둔다(P16). 잘 답한 가정이 30개를 넘으면 오래된 것이 다시 나올 수 있다, 기억이 그만큼 쌓이면 축별로 자르기로
  const retired = records
    .filter((r) => r.status === 'well')
    .sort(recentFirst)
    .slice(0, 30);
  const unexpectedFirst = (r                  ) =>
    lastEncounter(r)?.surprise === 'unexpected' ? 0 : 1;
  const reissue = records
    .filter((r) => isReissue(r, now, reissueAfterHours))
    .sort((a, b) => unexpectedFirst(a) - unexpectedFirst(b) || recentFirst(a, b))
    .slice(0, 5);
  const taken = new Set([...retired, ...reissue]);
  const expected = records
    .filter((r) => lastEncounter(r)?.surprise === 'expected' && !taken.has(r))
    .sort(recentFirst)
    .slice(0, 10);
  return { retired: retired.map(ref), reissue: reissue.map(ref), expected: expected.map(ref) };
}

/** 다시 낼 가정이 있는 주제(마지막 만남의 주제). */
export function pendingTopics(
  records                    ,
  now      ,
  reissueAfterHours        ,
)           {
  const topics = records
    .filter((r) => isReissue(r, now, reissueAfterHours))
    .map((r) => lastEncounter(r)?.topic)
    .filter((t)              => t !== undefined);
  return [...new Set(topics)];
}
