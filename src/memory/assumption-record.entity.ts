import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { AxisId } from '../interview/catalog';

@Entity({ name: 'assumption_records' })
export class AssumptionRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'axis', type: 'text' })
  axis!: AxisId;

  @Column({ name: 'statement', type: 'text' })
  statement!: string;

  @Column({ name: 'status', type: 'text' })
  status!: 'well' | 'wobbly' | 'wrong';

  @Column({ name: 'encounters', type: 'jsonb' })
  encounters!: {
    sessionId: string;
    turnId: string;
    topic: string;
    result: 'well' | 'wobbly' | 'wrong';
    surprise: 'expected' | 'unexpected' | null;
    at: string;
  }[];

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
