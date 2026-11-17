import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { PanelMember, PendingSecondary, QuestionMemory } from '../interview/types';

@Entity({ name: 'interview_sessions' })
export class InterviewSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'topic', type: 'text' })
  topic!: string;

  @Column({ name: 'panel', type: 'jsonb' })
  panel!: PanelMember[];

  @Column({ name: 'question_limit', type: 'integer' })
  questionLimit!: number;

  @Column({ name: 'status', type: 'text' })
  status!: 'in_progress' | 'finished';

  @Column({ name: 'user_mentioned', type: 'jsonb' })
  userMentioned!: string[];

  @Column({ name: 'unknown_techs', type: 'jsonb' })
  unknownTechs!: string[];

  @Column({ name: 'pending_secondary', type: 'jsonb', nullable: true })
  pendingSecondary!: PendingSecondary | null;

  @Column({ name: 'memory', type: 'jsonb' })
  memory!: QuestionMemory;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;
}
