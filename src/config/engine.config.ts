import { registerAs } from '@nestjs/config';

export type CallRole = 'analyze' | 'question' | 'verify' | 'leak';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface EngineConfig {
  models: Record<CallRole, string>;
  effort: Record<CallRole, Effort>;
  maxConsecutive: number;
  maxRegenerations: number;
}

export const CALL_ROLES: CallRole[] = ['analyze', 'question', 'verify', 'leak'];
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_EFFORT: Record<CallRole, Effort> = {
  analyze: 'medium',
  question: 'medium',
  verify: 'medium',
  leak: 'low',
};

// 빈 문자열은 설정 안 함으로 본다.
function read(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  return v === undefined || v === '' ? undefined : v;
}

function readEffort(env: NodeJS.ProcessEnv, role: CallRole): Effort {
  const key = `ENGINE_EFFORT_${role.toUpperCase()}`;
  const v = read(env, key);
  if (v === undefined) return DEFAULT_EFFORT[role];
  const effort = EFFORTS.find((e) => e === v);
  if (!effort) throw new Error(`${key}는 ${EFFORTS.join('/')} 중 하나여야 한다: ${v}`);
  return effort;
}

function readPositiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = read(env, key);
  if (v === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(v)) throw new Error(`${key}는 양의 정수여야 한다: ${v}`);
  return Number(v);
}

export function readEngineConfig(env: NodeJS.ProcessEnv): EngineConfig {
  const models = {} as Record<CallRole, string>;
  const effort = {} as Record<CallRole, Effort>;
  for (const role of CALL_ROLES) {
    models[role] = read(env, `ENGINE_MODEL_${role.toUpperCase()}`) ?? DEFAULT_MODEL;
    effort[role] = readEffort(env, role);
  }
  return {
    models,
    effort,
    maxConsecutive: readPositiveInt(env, 'ENGINE_MAX_CONSECUTIVE', 2),
    maxRegenerations: readPositiveInt(env, 'ENGINE_MAX_REGENERATIONS', 1),
  };
}

export const engineConfig = registerAs('engine', () => readEngineConfig(process.env));
