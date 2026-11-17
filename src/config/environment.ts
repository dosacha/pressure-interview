const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_DATABASE: string;
}

// 없는 값과 빈 문자열은 기본값으로 본다. 오류 메시지에는 변수 이름만 넣는다(비밀번호가 새지 않게).
function read(env: Record<string, unknown>, key: string): unknown {
  const value = env[key];
  return value === undefined || value === '' ? undefined : value;
}

function readString(env: Record<string, unknown>, key: string, fallback: string): string {
  const value = read(env, key) ?? fallback;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key}는 비어 있지 않은 문자열이어야 한다`);
  }
  return value;
}

function readPort(env: Record<string, unknown>, key: string, fallback: number): number {
  const value = read(env, key) ?? fallback;
  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${key}는 1~65535의 정수여야 한다`);
  }
  return port;
}

// 받은 키를 그대로 싣는다. @nestjs/config는 이 결과의 키만 process.env로 옮기므로
// ANTHROPIC_API_KEY와 ENGINE_*가 버려지지 않아야 한다.
export function validateEnvironment(
  env: Record<string, unknown>,
): Record<string, unknown> & EnvironmentVariables {
  const nodeEnv = read(env, 'NODE_ENV') ?? 'development';
  if (typeof nodeEnv !== 'string' || !NODE_ENVIRONMENTS.some((e) => e === nodeEnv)) {
    throw new Error(`NODE_ENV는 ${NODE_ENVIRONMENTS.join('/')} 중 하나여야 한다`);
  }
  return {
    ...env,
    NODE_ENV: nodeEnv as NodeEnvironment,
    PORT: readPort(env, 'PORT', 3110),
    DB_HOST: readString(env, 'DB_HOST', '127.0.0.1'),
    DB_PORT: readPort(env, 'DB_PORT', 5436),
    DB_USERNAME: readString(env, 'DB_USERNAME', 'interview'),
    DB_PASSWORD: readString(env, 'DB_PASSWORD', 'interview_local'),
    DB_DATABASE: readString(env, 'DB_DATABASE', 'interview'),
  };
}
