// 생성된 파일이다. 손으로 고치지 않는다. 원본: src/interview/rules.ts @ aeae0dd, 도구: tools/port-app-src.mjs
import { DEFECT_PRIORITY, REACTION_TABLE, ROLES } from './catalog.mjs';
                                                                     

export function pickNext(input   
                    
                       
                    
                         
 )       {
  const { panel, history, maxConsecutive } = input;
  // Array.prototype.sort is stable, so equal priorities keep their original order.
  const defects = [...input.defects].sort(
    (a, b) => DEFECT_PRIORITY[b.type] - DEFECT_PRIORITY[a.type],
  );

  const tail = history.slice(-maxConsecutive);
  const capped =
    history.length >= maxConsecutive && tail.every((id) => id === tail[0]) ? tail[0] : null;

  // Oldest last-question position first; never-asked is -1; ties keep panel order.
  const oldest = (pool               )              =>
    pool.reduce((best, m) => (history.lastIndexOf(m.id) < history.lastIndexOf(best.id) ? m : best));

  const owners = (defect        ) =>
    panel.filter((m) => (ROLES[m.role].axes            ).includes(defect.axis));
  const choice = (member             , defect        )             => ({
    interviewerId: member.id,
    defect,
    reactionIntent: REACTION_TABLE[defect.type][member.temperament],
  });

  const first = defects[0];
  const rest = panel.filter((m) => m.id !== capped);
  const owned = owners(first).filter((m) => m.id !== capped);
  const pool = owned.length ? owned : rest.length ? rest : panel;
  const primary = choice(oldest(pool), first);

  let secondary                    = null;
  const second = defects[1];
  if (second && DEFECT_PRIORITY[first.type] >= 3 && DEFECT_PRIORITY[second.type] >= 3) {
    const cands = owners(second).filter((m) => m.id !== primary.interviewerId && m.id !== capped);
    if (cands.length) secondary = choice(oldest(cands), second);
  }
  return { ...primary, secondary };
}
