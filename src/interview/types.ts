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
}
export interface PreparedQuestion {
  question: Question;
  verification: Verification | null;
  answerKeyCorrected: boolean;
  flags: { leak: boolean; premise: boolean };
  attempts: { question: Question; naming: NamingResult; verification: Verification | null }[];
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
}
