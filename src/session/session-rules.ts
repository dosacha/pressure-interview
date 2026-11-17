import type { AxisId, TemperamentId } from '../interview/catalog';
import type {
  JobRoleId,
  PanelMember,
  PendingSecondary,
  Pick,
  PickChoice,
} from '../interview/types';

export const CLOSING_TEXT = '준비한 질문은 여기까지입니다. 수고하셨습니다.';

export function composePanel(jobRole: JobRoleId, rng: () => number): PanelMember[] {
  const t: TemperamentId[] = ['persistent', 'helper', 'shaker'];
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
export function pickOpener(panel: PanelMember[], rng: () => number): PanelMember {
  return panel[Math.floor(rng() * panel.length)];
}

// 절반을 넘도록 가정 변경 질문이 없으면 정체성 비교 축을 지정해 한 번은 나오게 한다.
export function chooseTargetAxis(s: {
  nextSeq: number;
  questionLimit: number;
  assumptionAxes: (AxisId | 'none')[];
}): AxisId | null {
  if (s.nextSeq === 1) return null;
  const hasAssumption = s.assumptionAxes.some((a) => a !== 'none');
  return !hasAssumption && s.nextSeq > Math.ceil(s.questionLimit / 2) ? 'identity_swap' : null;
}

export function nextAsker(input: {
  lastTurnId: string;
  pick: Pick;
  pending: PendingSecondary | null;
}): { choice: PickChoice; addOn: boolean; causeTurnId: string; pending: PendingSecondary | null } {
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
