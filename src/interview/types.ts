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
// 화면에 나가는 질문과 그 숨은 의도·가정. 정답지는 없다
export interface QuestionDraft {
  text: string;
  questionIntent: QuestionIntentId;
  assumption: { axis: AxisId | 'none'; statement: string };
}
export interface Question extends QuestionDraft {
  answerKey: AnswerKey;
}
// 턴에 저장하는 모양. 정답지는 질문이 나간 뒤에 채운다
export type StoredQuestion = QuestionDraft & { answerKey: AnswerKey | null };
export interface PremiseCheck {
  premiseOk: boolean;
  problems: { field: 'text' | 'statement'; problem: string }[];
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
export interface PreparedDraft {
  draft: QuestionDraft;
  // 마지막 시도의 전제 검사. 가정 없는 질문이거나 이름 검사에서 걸렸으면 null
  premise: PremiseCheck | null;
  // premise는 보여 주기 전 전제 검사의 결과만 뜻한다
  flags: { leak: boolean; premise: boolean };
  attempts: {
    draft: QuestionDraft;
    naming: NamingResult;
    premise: PremiseCheck | null;
    // 흘림 검사가 돌려준 그대로(가정 없는 질문에서 premise를 solution으로 바꾸기 전)
    techs: TechMention[];
  }[];
  usage: TokenUsage[];
}
// 정답지 호출과 검증에 주는 입력. 질문을 쓸 때의 지시(userMentioned, avoidTechs, memory, feedback, targetAxis)는 없다
// 이 파일의 Pick(면접관 고르기)이 유틸리티 Pick을 가리므로 QuestionInput의 필드를 그대로 옮겨 적는다.
export interface AnswerKeyInput {
  topic: QuestionInput['topic'];
  interviewer: QuestionInput['interviewer'];
  reactionIntent: QuestionInput['reactionIntent'];
  defect: QuestionInput['defect'];
  addOn?: QuestionInput['addOn'];
  history: QuestionInput['history'];
  draft: QuestionDraft;
}
export interface CompletedQuestion {
  // 고친 정답지가 반영된 것
  question: Question;
  // answerKey는 고친 뒤의 것
  verification: Verification;
  // 검증이 정답지를 실제로 고쳤으면 true
  answerKeyCorrected: boolean;
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
export type JobRoleId = 'dba' | 'security' | 'architect';
export interface ClarifyInput {
  topic: string;
  interviewer: PanelMember;
  // 되묻기 응답은 정답지를 쓰지 않는다
  question: QuestionDraft;
  // 그 질문에서 검출된 기술(prepared.attempts의 마지막 항목의 techs. 없으면 [])
  questionTechs: TechMention[];
  // 이 질문에서 앞서 주고받은 되묻기
  exchanges: { ask: string; reply: string }[];
  ask: string;
  userMentioned: string[];
  avoidTechs: string[];
}
export interface ClarifyResult {
  reply: string;
  leak: boolean;
  usage: TokenUsage[];
}
export type AssumptionResult = 'well' | 'wobbly' | 'wrong';
export interface TurnReview {
  // 답이 질문 의도를 향했는가
  intent: { aimed: boolean; note: string };
  // 면접 중 분석의 결함 하나하나. index는 analysis.defects의 순서
  defects: { index: number; verdict: 'valid' | 'misjudged'; note: string }[];
  // 이 답에서 나온 질문 하나하나. index는 ReviewInput.followUps의 순서
  reactions: {
    index: number;
    verdict: 'valid_point' | 'misjudgment' | 'intended_test';
    note: string;
  }[];
  // userResult는 사용자가 복기에서 고친 결과다. 모델은 채우지 않는다
  assumption: {
    result: AssumptionResult | 'none';
    note: string;
    sameAs: string | null;
    userResult?: AssumptionResult;
  };
  // 복기가 정답지에서 찾은 오류
  keyProblems: string[];
}
export interface ReviewInput {
  topic: string;
  interviewer: PanelMember;
  // 이 질문이 나온 까닭
  cause: { reactionIntent: ReactionIntentId | null; defect: Defect | null };
  // 고친 정답지가 반영된 것
  question: Question;
  clarifications: { ask: string; reply: string }[];
  answer: string;
  // 면접 중 판정
  analysis: Analysis;
  // 이 답에서 나온 질문들(0~2개)
  followUps: {
    interviewerId: string;
    addOn: boolean;
    reactionIntent: ReactionIntentId;
    defect: Defect;
    text: string;
  }[];
  // 같은 축의 가정들. key는 기억의 id 또는 'turn:<턴 id>'
  knownAssumptions: { key: string; statement: string }[];
}
export interface Clarification {
  ask: string;
  reply: string;
  leak: boolean;
}
