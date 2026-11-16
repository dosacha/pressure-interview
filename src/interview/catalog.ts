export const AXES = [
  { id: 'scale', name: '규모' },
  { id: 'resource_limit', name: '자원 한도' },
  { id: 'cs_premise', name: 'CS 원리의 전제' },
  { id: 'distribution', name: '데이터 분포' },
  { id: 'failure', name: '장애 양상' },
  { id: 'attack', name: '공격' },
  { id: 'consistency', name: '일관성 완화' },
  { id: 'durability', name: '영속성·전달 보장' },
  { id: 'requirement_change', name: '요구·규제 변경' },
  { id: 'tech_swap', name: '기술 대체' },
  { id: 'cost', name: '비용' },
  { id: 'latency_budget', name: '지연 예산' },
  { id: 'time_org', name: '시간·조직' },
  { id: 'identity_swap', name: '기술의 핵심 속성 바꾸기(정체성 비교)' },
] as const;

export type AxisId = (typeof AXES)[number]['id'];

// 목록에 없는 id(none 등)는 id 그대로 돌려준다.
export const axisName = (id: string): string => AXES.find((a) => a.id === id)?.name ?? id;

// 모든 면접관이 질문에 쓰고, 결함 담당은 없다.
export const SHARED_AXES = ['identity_swap'] as const;
export type SharedAxisId = (typeof SHARED_AXES)[number];
export type OwnableAxisId = Exclude<AxisId, SharedAxisId>;
export const OWNABLE_AXES: OwnableAxisId[] = AXES.map((a) => a.id).filter(
  (id): id is OwnableAxisId => !(SHARED_AXES as readonly AxisId[]).includes(id),
);

export const QUESTION_INTENTS = {
  A1: '원리 이해',
  A2: '선택 근거',
  A3: '대안 시야',
  A4: '트레이드오프·한계 인식',
  A5: '검증·측정',
  A6: '경험 진위·본인 기여',
  A7: '개념의 실무 적용',
  A8: '규모 적응',
  A9: '극단 분포',
  A10: '장애·부분 실패',
  A11: '요구 변경·진화성',
  A12: '복잡도의 필요성',
  A13: '운영 경계·미래 부채',
  A14: '지식 경계 매핑',
  A15: '미지 문제 접근·학습 가능성',
} as const;
export type QuestionIntentId = keyof typeof QUESTION_INTENTS;

export const REACTION_INTENTS = {
  B1: '상향 심화',
  B2: '구체화 요구',
  B3: '근거 요구',
  B4: '누락 신호',
  B5: '방향 넛지',
  B6: '반례 재질문',
  B7: '맥락 보충 재질문',
  B8: '확신 시험',
  B9: '수용성 시험',
  B10: '과장 감지·레벨 재보정',
  B11: '전환·정리',
} as const;
export type ReactionIntentId = keyof typeof REACTION_INTENTS;

export const INTENT_GROUPS: {
  question: Record<string, QuestionIntentId[]>;
  reaction: Record<string, ReactionIntentId[]>;
} = {
  question: {
    깊이: ['A1', 'A14'],
    판단: ['A2', 'A3', 'A4', 'A12'],
    증명: ['A5', 'A6'],
    적응: ['A7', 'A8', 'A9', 'A10', 'A11', 'A13'],
    '미지 대응': ['A15'],
  },
  reaction: {
    올림: ['B1'],
    좁힘: ['B2', 'B3'],
    힌트: ['B4', 'B5', 'B7'],
    반박: ['B6', 'B8', 'B9'],
    전환: ['B10', 'B11'],
  },
};

export const DEFECT_TYPES = [
  'none',
  'wrong',
  'missing_axis',
  'no_why',
  'no_tradeoff',
  'vague',
  'no_evidence',
] as const;
export type DefectType = (typeof DEFECT_TYPES)[number];

// 설계 6.2의 3단계 결함 유형 이름
export const DEFECT_NAMES: Record<DefectType, string> = {
  none: '결함 없음(강한 답)',
  wrong: '오답 의심',
  missing_axis: '축 누락',
  no_why: 'why 없음',
  no_tradeoff: '트레이드오프 누락',
  vague: '모호함',
  no_evidence: '근거 없음',
};

export const DEFECT_PRIORITY: Record<DefectType, number> = {
  wrong: 4,
  missing_axis: 3,
  no_why: 2,
  no_tradeoff: 2,
  vague: 1,
  no_evidence: 1,
  none: 0,
};

export type RoleId = 'dba' | 'security' | 'architect' | 'textbook' | 'scenario';

export const ROLES: Record<
  RoleId,
  {
    type: 'job' | 'textbook' | 'scenario';
    name: string;
    axes: OwnableAxisId[];
    intents: QuestionIntentId[];
  }
> = {
  dba: {
    type: 'job',
    name: 'DBA',
    axes: ['durability', 'consistency', 'distribution'],
    intents: ['A1', 'A4'],
  },
  security: { type: 'job', name: '보안', axes: ['attack', 'failure'], intents: ['A10'] },
  architect: {
    type: 'job',
    name: '아키텍트',
    axes: ['tech_swap', 'cost', 'requirement_change', 'time_org'],
    intents: ['A2', 'A3', 'A12'],
  },
  textbook: {
    type: 'textbook',
    name: '교과형',
    axes: ['resource_limit', 'cs_premise'],
    intents: ['A1', 'A14'],
  },
  scenario: {
    type: 'scenario',
    name: '시나리오형',
    axes: ['scale', 'distribution', 'latency_budget'],
    intents: ['A8', 'A9'],
  },
};

export const TEMPERAMENTS = {
  persistent: '집요형',
  helper: '조력형',
  shaker: '흔드는형',
} as const;
export type TemperamentId = keyof typeof TEMPERAMENTS;

export const REACTION_TABLE: Record<DefectType, Record<TemperamentId, ReactionIntentId>> = {
  none: { persistent: 'B1', helper: 'B1', shaker: 'B8' },
  wrong: { persistent: 'B6', helper: 'B7', shaker: 'B9' },
  missing_axis: { persistent: 'B6', helper: 'B4', shaker: 'B9' },
  no_why: { persistent: 'B3', helper: 'B5', shaker: 'B8' },
  no_tradeoff: { persistent: 'B4', helper: 'B4', shaker: 'B9' },
  vague: { persistent: 'B2', helper: 'B7', shaker: 'B2' },
  no_evidence: { persistent: 'B3', helper: 'B3', shaker: 'B8' },
};
