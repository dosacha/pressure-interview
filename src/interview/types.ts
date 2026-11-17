import type {
  AxisId,
  DefectType,
  OwnableAxisId,
  QuestionIntentId,
  ReactionIntentId,
  RoleId,
  TemperamentId,
} from './catalog';

export interface PanelMember {
  id: string;
  role: RoleId;
  temperament: TemperamentId;
}
export interface Defect {
  type: DefectType;
  axis: OwnableAxisId;
  note: string;
}
export interface PickChoice {
  interviewerId: string;
  defect: Defect;
  reactionIntent: ReactionIntentId;
}
export interface Pick extends PickChoice {
  secondary: PickChoice | null;
}
export interface AnswerKey {
  vanishing: string[];
  remaining: string[];
  alternatives: { name: string; traits: string }[];
  keyPoints: string[];
}
export interface Question {
  text: string;
  questionIntent: QuestionIntentId;
  assumption: { axis: AxisId | 'none'; statement: string };
  answerKey: AnswerKey;
}
export interface Analysis {
  kind: 'answer' | 'clarify';
  defects: Defect[];
  mentionedTechs: string[];
  unknownTechs?: string[];
}
export interface Verification {
  premiseOk: boolean;
  problems: { field: string; problem: string }[];
  answerKey: AnswerKey;
}
export interface TechMention {
  name: string;
  role: 'premise' | 'solution' | 'user';
}
export interface NamingResult {
  ok: boolean;
  violations: string[];
  // violations 가운데 지원자가 모른다고 한 기술
  avoided: string[];
}
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}
export interface QuestionInput {
  topic: string;
  interviewer: PanelMember;
  reactionIntent: ReactionIntentId | null;
  defect: Defect | null;
  targetAxis: AxisId | null;
  history: { interviewerId: string; text: string; answer: string }[];
  userMentioned: string[];
  feedback: string[];
  avoidTechs?: string[];
  addOn?: boolean;
  memory?: QuestionMemory;
}
export interface PreparedQuestion {
  question: Question;
  verification: Verification | null;
  answerKeyCorrected: boolean;
  flags: { leak: boolean; premise: boolean };
  attempts: {
    question: Question;
    naming: NamingResult;
    verification: Verification | null;
    // 흘림 검사가 돌려준 그대로(가정 없는 질문에서 premise를 solution으로 바꾸기 전)
    techs?: TechMention[];
  }[];
  usage: TokenUsage[];
}
export interface AnswerInput {
  topic: string;
  panel: PanelMember[];
  history: string[];
  askedBy: string;
  question: Question;
  answer: string;
  userMentioned: string[];
}
export interface AnswerResult {
  analysis: Analysis;
  pick: Pick | null;
  userMentioned: string[];
  usage: TokenUsage[];
  // 분석의 unknownTechs에서 이미 말한 기술을 걸러 낸 목록
  unknownTechs: string[];
}

export interface AssumptionRef {
  axis: AxisId;
  statement: string;
}
export interface QuestionMemory {
  retired: AssumptionRef[];
  reissue: AssumptionRef[];
  expected: AssumptionRef[];
}
// 기다리는 덧붙이기와, 그것을 낳은 답의 턴
export interface PendingSecondary {
  choice: PickChoice;
  causeTurnId: string;
}
export interface Clarification {
  ask: string;
  reply: string;
  leak: boolean;
}
