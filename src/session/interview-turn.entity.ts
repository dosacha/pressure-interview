import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { AxisId, ReactionIntentId } from '../interview/catalog';
import type {
  Analysis,
  Clarification,
  Defect,
  Pick,
  PreparedDraft,
  StoredQuestion,
  TurnReview,
  Verification,
} from '../interview/types';

@Entity({ name: 'interview_turns' })
export class InterviewTurn {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ name: 'seq', type: 'integer' })
  seq!: number;

  @Column({ name: 'interviewer_id', type: 'text' })
  interviewerId!: string;

  @Column({ name: 'add_on', type: 'boolean' })
  addOn!: boolean;

  @Column({ name: 'cause_turn_id', type: 'uuid', nullable: true })
  causeTurnId!: string | null;

  @Column({ name: 'reaction_intent', type: 'text', nullable: true })
  reactionIntent!: ReactionIntentId | null;

  @Column({ name: 'defect', type: 'jsonb', nullable: true })
  defect!: Defect | null;

  @Column({ name: 'target_axis', type: 'text', nullable: true })
  targetAxis!: AxisId | null;

  @Column({ name: 'question', type: 'jsonb' })
  question!: StoredQuestion;

  // 계획 2 A2 이전에 끝난 면접의 행은 예전 모양(attempts에 question·verification)으로 남아 있다.
  @Column({ name: 'prepared', type: 'jsonb' })
  prepared!: {
    flags: PreparedDraft['flags'];
    answerKeyCorrected: boolean;
    attempts: PreparedDraft['attempts'];
  };

  @Column({ name: 'verification', type: 'jsonb', nullable: true })
  verification!: Verification | null;

  @Column({ name: 'clarifications', type: 'jsonb' })
  clarifications!: Clarification[];

  @Column({ name: 'answer', type: 'text', nullable: true })
  answer!: string | null;

  @Column({ name: 'answer_start_ms', type: 'integer', nullable: true })
  answerStartMs!: number | null;

  @Column({ name: 'answered_at', type: 'timestamptz', nullable: true })
  answeredAt!: Date | null;

  @Column({ name: 'analysis', type: 'jsonb', nullable: true })
  analysis!: Analysis | null;

  @Column({ name: 'pick', type: 'jsonb', nullable: true })
  pick!: Pick | null;

  @Column({ name: 'surprise', type: 'text', nullable: true })
  surprise!: 'expected' | 'unexpected' | null;

  @Column({ name: 'review', type: 'jsonb', nullable: true })
  review!: TurnReview | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
