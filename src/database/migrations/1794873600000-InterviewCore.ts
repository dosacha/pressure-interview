import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InterviewCore1794873600000 implements MigrationInterface {
  name = 'InterviewCore1794873600000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE public.interview_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      topic text NOT NULL CHECK (length(topic) BETWEEN 1 AND 200),
      panel jsonb NOT NULL,
      question_limit integer NOT NULL CHECK (question_limit BETWEEN 2 AND 30),
      status text NOT NULL CHECK (status IN ('in_progress','finished')),
      user_mentioned jsonb NOT NULL,
      unknown_techs jsonb NOT NULL DEFAULT '[]',
      pending_secondary jsonb,
      memory jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      reviewed_at timestamptz
    )`);
    await runner.query(`CREATE TABLE public.interview_turns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
      seq integer NOT NULL CHECK (seq > 0),
      interviewer_id text NOT NULL,
      add_on boolean NOT NULL DEFAULT false,
      cause_turn_id uuid REFERENCES public.interview_turns(id) ON DELETE SET NULL,
      reaction_intent text,
      defect jsonb,
      target_axis text,
      question jsonb NOT NULL,
      prepared jsonb NOT NULL,
      verification jsonb,
      clarifications jsonb NOT NULL DEFAULT '[]',
      answer text,
      answer_start_ms integer CHECK (answer_start_ms >= 0),
      answered_at timestamptz,
      analysis jsonb,
      pick jsonb,
      surprise text CHECK (surprise IN ('expected','unexpected')),
      review jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_interview_turns_session_seq" UNIQUE (session_id, seq)
    )`);
    await runner.query(`CREATE TABLE public.assumption_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      axis text NOT NULL,
      statement text NOT NULL,
      status text NOT NULL CHECK (status IN ('well','wobbly','wrong')),
      encounters jsonb NOT NULL,
      last_seen_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await runner.query(
      `CREATE INDEX "IDX_assumption_records_axis" ON public.assumption_records (axis)`,
    );
    // session_id에 FK를 두지 않는다. 면접을 시작하다 실패한 호출도 과금되므로, 세션 행이 없어도 사용량은 남아야 한다.
    await runner.query(`CREATE TABLE public.llm_usage (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL,
      call_role text NOT NULL,
      model text NOT NULL,
      input_tokens integer NOT NULL CHECK (input_tokens >= 0),
      output_tokens integer NOT NULL CHECK (output_tokens >= 0),
      fallback boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await runner.query(`CREATE INDEX "IDX_llm_usage_session" ON public.llm_usage (session_id)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE public.interview_turns`);
    await runner.query(`DROP TABLE public.interview_sessions`);
    await runner.query(`DROP TABLE public.assumption_records`);
    await runner.query(`DROP TABLE public.llm_usage`);
  }
}
