import { spawn, type SpawnOptions } from 'node:child_process';

const COMPOSE_FILE = 'compose.e2e.yaml';

function run(
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

async function runRequired(command: string, args: string[], options: SpawnOptions = {}) {
  const { code } = await run(command, args, options);
  if (code !== 0) throw new CommandFailed(`${command} ${args.join(' ')}`, code);
}

class CommandFailed extends Error {
  constructor(
    command: string,
    readonly exitCode: number,
  ) {
    super(`${command} 종료 코드 ${exitCode}`);
  }
}

// npm.cmd를 shell 없이 spawn하면 Windows에서 실패하므로 node로 npm-cli를 직접 부른다.
function npmRun(script: string, env: NodeJS.ProcessEnv): Promise<void> {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('npm run으로 실행해야 한다(npm run test:e2e)');
  return runRequired(process.execPath, [npmCli, 'run', script], { env });
}

async function main(): Promise<number> {
  const project = `pressure-interview-e2e-${process.pid}-${Date.now()}`;
  const compose = (...args: string[]) => ['compose', '-p', project, '-f', COMPOSE_FILE, ...args];
  try {
    await runRequired('docker', compose('up', '-d', '--wait', 'db'));
    const { code, stdout } = await run('docker', compose('port', 'db', '5432'), { capture: true });
    const port = /:(\d+)\s*$/.exec(stdout.trim().split(/\r?\n/).at(-1) ?? '')?.[1];
    if (code !== 0 || !port) throw new Error('e2e PostgreSQL 포트를 알아내지 못했다');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: '127.0.0.1',
      DB_PORT: port,
      DB_USERNAME: 'interview_e2e',
      DB_PASSWORD: 'interview_e2e_local',
      DB_DATABASE: 'interview_e2e',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
      ANTHROPIC_API_KEY: 'e2e-not-a-key',
    };
    await npmRun('migration:run', env);
    await npmRun('test:e2e:jest', env);
    return 0;
  } catch (error) {
    console.error(`e2e failed: ${error instanceof Error ? error.message : String(error)}`);
    return error instanceof CommandFailed ? error.exitCode : 1;
  } finally {
    await run('docker', compose('down', '--volumes', '--remove-orphans')).catch((error: unknown) =>
      console.error(`e2e database cleanup failed: ${String(error)}`),
    );
  }
}

void main().then((code) => {
  process.exitCode = code;
});
