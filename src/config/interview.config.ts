import { registerAs } from '@nestjs/config';

export interface InterviewConfig {
  questionLimit: number;
  reissueAfterHours: number;
}

// 빈 문자열은 설정 안 함으로 본다.
function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  if (!/^[1-9]\d*$/.test(v) || Number(v) < min || Number(v) > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? '양의 정수' : `${min}~${max}의 정수`;
    throw new Error(`${key}는 ${range}여야 한다: ${v}`);
  }
  return Number(v);
}

export function readInterviewConfig(env: NodeJS.ProcessEnv): InterviewConfig {
  return {
    questionLimit: readInt(env, 'INTERVIEW_QUESTION_LIMIT', 6, 2, 30),
    reissueAfterHours: readInt(
      env,
      'MEMORY_REISSUE_AFTER_HOURS',
      24,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

export const interviewConfig = registerAs('interview', () => readInterviewConfig(process.env));
