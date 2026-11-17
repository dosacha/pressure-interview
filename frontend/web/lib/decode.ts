// shortcut: 서버 타입을 손으로 옮겼다, 필드가 자주 바뀌면 공유 타입 폴더로
export interface PublicTurn {
  id: string;
  seq: number;
  interviewerId: string;
  addOn: boolean;
  text: string;
  clarifications: { ask: string; reply: string }[];
  answer: string | null;
}

export interface InterviewView {
  id: string;
  topic: string;
  status: 'in_progress' | 'finished';
  questionLimit: number;
  panel: { id: string; roleName: string }[];
  turns: PublicTurn[];
  pending: 'answer' | 'retry' | null;
  closing: { interviewerId: string; text: string } | null;
  createdAt: string;
}

export interface InterviewListItem {
  id: string;
  topic: string;
  status: 'in_progress' | 'finished';
  createdAt: string;
  questionCount: number;
}

type Raw = Record<string, unknown>;

function bad(what: string): never {
  throw new Error(`서버 응답의 모양이 다르다: ${what}`);
}
function obj(v: unknown, what: string): Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : bad(what);
}
function str(v: unknown, what: string): string {
  return typeof v === 'string' ? v : bad(what);
}
function num(v: unknown, what: string): number {
  return typeof v === 'number' ? v : bad(what);
}
function arr(v: unknown, what: string): unknown[] {
  return Array.isArray(v) ? (v as unknown[]) : bad(what);
}
function status(v: unknown): 'in_progress' | 'finished' {
  return v === 'in_progress' || v === 'finished' ? v : bad('status');
}

function decodeTurn(v: unknown): PublicTurn {
  const t = obj(v, 'turn');
  if (typeof t.addOn !== 'boolean') bad('turn.addOn');
  return {
    id: str(t.id, 'turn.id'),
    seq: num(t.seq, 'turn.seq'),
    interviewerId: str(t.interviewerId, 'turn.interviewerId'),
    addOn: t.addOn,
    text: str(t.text, 'turn.text'),
    clarifications: arr(t.clarifications, 'turn.clarifications').map((c) => {
      const o = obj(c, 'clarification');
      return { ask: str(o.ask, 'clarification.ask'), reply: str(o.reply, 'clarification.reply') };
    }),
    answer: t.answer === null ? null : str(t.answer, 'turn.answer'),
  };
}

export function decodeInterviewView(v: unknown): InterviewView {
  const o = obj(v, 'view');
  const pending = o.pending;
  if (pending !== 'answer' && pending !== 'retry' && pending !== null) bad('pending');
  let closing: InterviewView['closing'] = null;
  if (o.closing !== null) {
    const c = obj(o.closing, 'closing');
    closing = {
      interviewerId: str(c.interviewerId, 'closing.interviewerId'),
      text: str(c.text, 'closing.text'),
    };
  }
  return {
    id: str(o.id, 'id'),
    topic: str(o.topic, 'topic'),
    status: status(o.status),
    questionLimit: num(o.questionLimit, 'questionLimit'),
    panel: arr(o.panel, 'panel').map((p) => {
      const m = obj(p, 'panel member');
      return { id: str(m.id, 'panel.id'), roleName: str(m.roleName, 'panel.roleName') };
    }),
    turns: arr(o.turns, 'turns').map(decodeTurn),
    pending,
    closing,
    createdAt: str(o.createdAt, 'createdAt'),
  };
}

export function decodeInterviewList(v: unknown): InterviewListItem[] {
  return arr(v, 'list').map((x) => {
    const o = obj(x, 'list item');
    return {
      id: str(o.id, 'id'),
      topic: str(o.topic, 'topic'),
      status: status(o.status),
      createdAt: str(o.createdAt, 'createdAt'),
      questionCount: num(o.questionCount, 'questionCount'),
    };
  });
}
