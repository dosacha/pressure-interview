// 생성된 파일이다. 손으로 고치지 않는다. 원본: src/review/stats.ts @ aeae0dd, 도구: tools/port-app-src.mjs
                                                                           
                                                                            
                                                                      

                        
                   
             
               
                  
                 
                                       
                                   
      
 

function median(values          )                {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function computeStats(
  sessions                    ,
  turns                 ,
  records                    ,
)        {
  const improved = records.filter((r) => {
    if (r.status !== 'well') return false;
    const latest = Math.max(...r.encounters.map((e) => Date.parse(e.at)));
    return r.encounters.some(
      (e) => Date.parse(e.at) < latest && (e.result === 'wobbly' || e.result === 'wrong'),
    );
  }).length;
  const recent = sessions
    .filter((s) => s.status === 'finished')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10);
  return {
    improved,
    sessions: recent.map((s) => {
      const own = turns.filter((t) => t.sessionId === s.id);
      const marked = own.filter((t) => t.surprise !== null);
      return {
        id: s.id,
        topic: s.topic,
        date: s.createdAt.toISOString(),
        medianAnswerStartMs: median(
          own.map((t) => t.answerStartMs).filter((v)              => v !== null),
        ),
        unexpectedRatio:
          marked.length === 0
            ? null
            : marked.filter((t) => t.surprise === 'unexpected').length / marked.length,
      };
    }),
  };
}
