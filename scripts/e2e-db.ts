import { spawn, type SpawnOptions } from 'node:child_process';

const COMPOSE_FILE = 'compose.e2e.yaml';

export function run(
  command: string,
  args: string[],
  options: SpawnOptions & { capture?: boolean } = {},
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const { capture, ...spawnOptions } = options;
    const child = spawn(command, args, {
      ...spawnOptions,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => (stdout += chunk));
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code: code ?? 1, stdout }));
  });
}

export class CommandFailed extends Error {
  constructor(
    command: string,
    readonly exitCode: number,
  ) {
    super(`${command} 종료 코드 ${exitCode}`);
  }
}

export async function runRequired(command: string, args: string[], options: SpawnOptions = {}) {
  const { code } = await run(command, args, options);
  if (code !== 0) throw new CommandFailed(`${command} ${args.join(' ')}`, code);
}

// npm.cmd를 shell 없이 spawn하면 Windows에서 실패하므로 node로 npm-cli를 직접 부른다.
export function npmRun(script: string, env: NodeJS.ProcessEnv): Promise<void> {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('npm run으로 실행해야 한다(npm run <script>)');
  return runRequired(process.execPath, [npmCli, 'run', script], { env });
}

export interface E2eDb {
  /** 이 DB에 붙는 환경 변수(NODE_ENV, DB_*, 가짜 Anthropic 값). */
  env: NodeJS.ProcessEnv;
  /** 임시 DB와 볼륨을 지운다. */
  down(): Promise<void>;
}

/** 임시 PostgreSQL을 띄우고 포트를 읽는다. 실패하면 직접 지운 뒤 던진다. */
export async function startE2eDb(): Promise<E2eDb> {
  const project = `pressure-interview-e2e-${process.pid}-${Date.now()}`;
  const compose = (...args: string[]) => ['compose', '-p', project, '-f', COMPOSE_FILE, ...args];
  const down = () =>
    run('docker', compose('down', '--volumes', '--remove-orphans')).then(
      () => undefined,
      (error: unknown) => console.error(`e2e database cleanup failed: ${String(error)}`),
    );
  try {
    await runRequired('docker', compose('up', '-d', '--wait', 'db'));
    const { code, stdout } = await run('docker', compose('port', 'db', '5432'), { capture: true });
    const port = /:(\d+)\s*$/.exec(stdout.trim().split(/\r?\n/).at(-1) ?? '')?.[1];
    if (code !== 0 || !port) throw new Error('e2e PostgreSQL 포트를 알아내지 못했다');
    return {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_HOST: '127.0.0.1',
        DB_PORT: port,
        DB_USERNAME: 'interview_e2e',
        DB_PASSWORD: 'interview_e2e_local',
        DB_DATABASE: 'interview_e2e',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
        ANTHROPIC_API_KEY: 'e2e-not-a-key',
      },
      down,
    };
  } catch (error) {
    await down();
    throw error;
  }
}
