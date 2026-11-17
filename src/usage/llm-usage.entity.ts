import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'llm_usage' })
export class LlmUsage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ name: 'call_role', type: 'text' })
  callRole!: string;

  @Column({ name: 'model', type: 'text' })
  model!: string;

  @Column({ name: 'input_tokens', type: 'integer' })
  inputTokens!: number;

  @Column({ name: 'output_tokens', type: 'integer' })
  outputTokens!: number;

  @Column({ name: 'fallback', type: 'boolean' })
  fallback!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
