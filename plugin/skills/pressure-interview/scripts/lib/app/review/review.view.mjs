// 서버판 src/review/review.view.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
import { axisName, DEFECT_NAMES, INTENT_GROUPS, QUESTION_INTENTS, REACTION_INTENTS, ROLES, SIGNAL_NAMES, TEMPERAMENTS } from '../interview/catalog.mjs';
import { areaStatus, checkJudgment, threadScore, threadsOf } from '../../thread.mjs';
             
            
                   
         
              
             
                            
                                                               
                                                                            
                                                                      
                                                                
                                                           

                                                          

                                 
             
              
                 
                                                                         
               
                                                                  
                 
                               
                         
          
                                  
                                                                        
    
                                                             
                       
                              
                    
                       
                                                                   
                                                                                         
                            
                                             
 

                             
             
                
                    
                                       
                                            
                                                      
                                      
                                                                
                
                     
                      
                             
                    
      
                        
 

/** 복기 대상 턴: 답이 있고 분석이 답(되묻기가 아님)인 턴. */
export const isReviewTarget = (t               )          =>
  t.answer !== null && t.analysis?.kind === 'answer';

/** 복기 대상 턴의 정답지. 분석 전에 맞추므로 있어야 한다. */
export function answerKeyOf(t               )            {
  if (t.question.answerKey === null) throw new Error(`정답지가 없는 질문이다: ${t.id}`);
  return t.question.answerKey;
}

/** 이 답에서 나온 질문: 이 턴이 원인인 턴들(seq 순). */
export const followUpsOf = (t               , turns                 )                  =>
  turns.filter((f) => f.causeTurnId === t.id).sort((a, b) => a.seq - b.seq);

export function memberOf(session                  , interviewerId        )              {
  const m = session.panel.find((p) => p.id === interviewerId);
  if (!m) throw new Error(`패널에 없는 면접관이다: ${interviewerId}`);
  return m;
}

function groupOf                  (groups                     , id   )         {
  const found = Object.entries(groups).find(([, ids]) => ids.includes(id));
  if (!found) throw new Error(`묶음에 없는 의도다: ${id}`);
  return found[0];
}
const questionIntent = (id                  )         => ({
  id,
  name: QUESTION_INTENTS[id],
  group: groupOf(INTENT_GROUPS.question, id),
});
const reactionIntent = (id                  )         => ({
  id,
  name: REACTION_INTENTS[id],
  group: groupOf(INTENT_GROUPS.reaction, id),
});
const defectView = (d        ) => ({
  typeName: DEFECT_NAMES[d.type],
  axisName: axisName(d.axis),
  note: d.note,
});

function toTurnView(
  session                  ,
  t               ,
  turns                 ,
)                 {
  const m = memberOf(session, t.interviewerId);
  const { assumption } = t.question;
  return {
    id: t.id,
    seq: t.seq,
    addOn: t.addOn,
    interviewer: {
      id: m.id,
      roleName: ROLES[m.role].name,
      temperamentName: TEMPERAMENTS[m.temperament],
    },
    text: t.question.text,
    clarifications: t.clarifications.map((c) => ({ ask: c.ask, reply: c.reply, leak: c.leak })),
    answer: t.answer ,
    answerStartMs: t.answerStartMs,
    questionIntent: questionIntent(t.question.questionIntent),
    cause: {
      reactionIntent: t.reactionIntent === null ? null : reactionIntent(t.reactionIntent),
      defect: t.defect === null ? null : defectView(t.defect),
    },
    assumption:
      assumption.axis === 'none'
        ? null
        : { axisName: axisName(assumption.axis), statement: assumption.statement },
    answerKey: answerKeyOf(t),
    answerKeyCorrected: t.prepared.answerKeyCorrected,
    leakFlag: t.prepared.flags.leak,
    premiseFlag: t.prepared.flags.premise || t.verification?.premiseOk === false,
    analysis: t.analysis .defects.map(defectView),
    followUps: followUpsOf(t, turns).map((f) => {
      if (f.reactionIntent === null) throw new Error(`반응 의도가 없는 후속 질문이다: ${f.id}`);
      return {
        seq: f.seq,
        addOn: f.addOn,
        roleName: ROLES[memberOf(session, f.interviewerId).role].name,
        reactionIntent: reactionIntent(f.reactionIntent),
      };
    }),
    review: t.review,
    surprise: t.surprise,
    score: t.analysis.score ?? null,
    reviewedScore: reviewedScoreOf(t),
    scoreNote: t.review?.scoreCheck?.note ?? '',
    signals: (t.analysis.signals ?? []).map((s) => ({ typeName: SIGNAL_NAMES[s.type], quote: s.quote })),
  };
}

// 복기가 점수를 안 줬거나(null) 예전 복기이면 면접 중 점수를 그대로 쓴다.
const reviewedScoreOf = (t) => t.review?.scoreCheck?.score ?? t.analysis?.score ?? null;

// 줄기의 틀(끝났는지, 꼬리질문 종류)은 그대로 두고 점수만 바로잡은 점수로 바꾼다.
function reviewedThreadsOf(threads, turns) {
  const bySeq = new Map(turns.map((t) => [t.seq, t]));
  const at = (seq, fallback) => (seq !== null && bySeq.has(seq) && fallback !== null ? reviewedScoreOf(bySeq.get(seq)) : fallback);
  return threads.map((th) => {
    const next = { ...th, openScore: at(th.openSeq, th.openScore), followScore: at(th.followSeq, th.followScore) };
    return { ...next, score: threadScore(next) };
  });
}

const nonNull = (xs) => xs.filter((x) => x !== null);

// 끝낸 까닭과 영역별 표. 줄기 장부가 없는 예전 면접이면 둘 다 null이다.
function endingViews(session, turns, judgment) {
  if (!session.topicMap) return { end: null, areas: null };
  const threads = threadsOf(turns);
  const reviewed = reviewedThreadsOf(threads, turns);
  const status = areaStatus(session.topicMap, threads);
  const areas = session.topicMap.areas.map((a) => {
    const mine = threads.filter((t) => t.areaId === a.id);
    return {
      name: a.name,
      core: a.core,
      asked: status[a.id].asked,
      score: nonNull(mine.map((t) => t.score)),
      reviewedScore: nonNull(reviewed.filter((t) => t.areaId === a.id).map((t) => t.score)),
      signals: mine.flatMap((t) => t.signals.map((s) => SIGNAL_NAMES[s.type])),
    };
  });
  const { end } = session;
  if (!end) return { end: null, areas };
  const j = end.by === 'claude' ? judgment : null;
  const recheck = j && ['enough', 'settled'].includes(end.decision) ? checkJudgment({ judgment: j, topicMap: session.topicMap, threads: reviewed }).failed : [];
  return {
    end: { by: end.by, decision: end.decision ?? null, note: j?.note ?? '', evidence: j?.evidence ?? null, candidates: j?.candidates ?? [], recheckFailed: recheck },
    areas,
  };
}

// 끝난 면접에만 쓴다. 숨긴 값(의도·정답지·분석·성향)이 모두 실린다.
export function toReviewView(
  session                  ,
  turns                 ,
  extra   
                     
                               
                               
                          
   ,
)             {
  const targets = turns.filter(isReviewTarget);
  const seqOf = new Map(turns.map((t) => [t.id, t.seq]));
  return {
    id: session.id,
    topic: session.topic,
    createdAt: session.createdAt.toISOString(),
    status: extra.running ? 'pending' : session.reviewedAt !== null ? 'ready' : 'none',
    progress: { done: targets.filter((t) => t.review !== null).length, total: targets.length },
    error: extra.error,
    turns: targets.map((t) => toTurnView(session, t, turns)),
    skippedAnswers: turns.filter((t) => t.answer !== null && !isReviewTarget(t)).length,
    assumptions: extra.folded.map((f) => ({
      axisName: axisName(f.axis),
      statement: f.statement,
      result: f.result,
      turnSeq: seqOf.get(f.turnIds[f.turnIds.length - 1]) ,
    })),
    usage: extra.usage,
    ...endingViews(session, turns, extra.judgment ?? null),
  };
}
