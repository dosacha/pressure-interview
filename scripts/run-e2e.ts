import { CommandFailed, npmRun, startE2eDb } from './e2e-db';

async function main(): Promise<number> {
  let db: Awaited<ReturnType<typeof startE2eDb>> | undefined;
  try {
    db = await startE2eDb();
    await npmRun('migration:run', db.env);
    await npmRun('test:e2e:jest', db.env);
    return 0;
  } catch (error) {
    console.error(`e2e failed: ${error instanceof Error ? error.message : String(error)}`);
    return error instanceof CommandFailed ? error.exitCode : 1;
  } finally {
    await db?.down();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
