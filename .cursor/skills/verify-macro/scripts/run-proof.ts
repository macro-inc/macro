#!/usr/bin/env bun

import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [specFile, separator, ...testArgs] = process.argv.slice(2);

if (!specFile || separator !== '--') {
  console.error(
    'Usage: bun .cursor/skills/verify-macro/scripts/run-proof.ts <spec-file> -- [Playwright args]'
  );
  process.exit(2);
}

const repoRoot = process.cwd();
const runId = `${new Date().toISOString().replaceAll(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const instance = process.env.LOCAL_E2E_INSTANCE ?? `verify-macro-${runId}`;
if (
  !/^verify-macro-[a-z0-9_-]+$/.test(instance) ||
  instance.length > 40
) {
  console.error(
    'LOCAL_E2E_INSTANCE must start with "verify-macro-" and contain at most 40 lowercase letters, digits, hyphens, or underscores'
  );
  process.exit(2);
}
const proofDir = resolve(
  process.env.PROOF_DIR ??
    join(repoRoot, '.cursor/verification/verify-macro', runId)
);
const playwrightDir = join(proofDir, 'playwright');
const doctorLog = join(proofDir, 'doctor.txt');
const runLog = join(proofDir, 'run.txt');
const resultPath = join(proofDir, 'result.json');
const nix = [
  'env',
  '-u',
  'CARGO_TARGET_DIR',
  'nix',
  '--extra-experimental-features',
  'nix-command flakes',
  'develop',
  '--command',
];

let activeProcess: ChildProcess | undefined;
let activeExit: Promise<number> | undefined;
let cleanupPromise: Promise<number> | undefined;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function run(
  command: string[],
  logPath?: string
): Promise<number> {
  const rendered = command.map(shellQuote).join(' ');
  if (logPath) await writeFile(logPath, `$ ${rendered}\n`);
  const shellCommand = logPath
    ? `${rendered} 2>&1 | tee -a ${shellQuote(logPath)}`
    : rendered;

  const child = spawn('bash', ['-o', 'pipefail', '-c', shellCommand], {
    cwd: repoRoot,
    env: process.env,
    detached: true,
    stdio: 'inherit',
  });
  const exit = new Promise<number>((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
  activeProcess = child;
  activeExit = exit;
  const exitCode = await exit;
  if (activeProcess === child) {
    activeProcess = undefined;
    activeExit = undefined;
  }
  if (logPath) await appendFile(logPath, `\nexit_status=${exitCode}\n`);
  return exitCode;
}

function cleanup(): Promise<number> {
  cleanupPromise ??= run([
    ...nix,
    'just',
    'stack',
    'down',
    '--instance',
    instance,
  ]);
  return cleanupPromise;
}

async function stop(signalExitCode: number): Promise<never> {
  const pid = activeProcess?.pid;
  const exit = activeExit;
  if (pid !== undefined) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // The child already exited.
    }
  }
  await exit;
  await cleanup();
  process.exit(signalExitCode);
}

process.on('SIGINT', () => void stop(130));
process.on('SIGTERM', () => void stop(143));

await mkdir(proofDir, { recursive: true });

let doctorExit: number | undefined;
let warmupExit: number | undefined;
let proofExit: number | undefined;
let cleanupExit: number | undefined;
let traceArchives: string[] = [];

try {
  doctorExit = await run(
    [...nix, 'just', 'doctor-local', '--instance', instance],
    doctorLog
  );
  if (doctorExit !== 0) throw new Error('doctor failed');

  warmupExit = await run([
    ...nix,
    'bash',
    '-lc',
    '\\cd apps/web && bunx playwright install chromium && just ensure-cache-wasm && just ensure-agent-fold-wasm',
  ]);
  if (warmupExit !== 0) throw new Error('browser or WASM warmup failed');

  proofExit = await run(
    [
      ...nix,
      'env',
      `LOCAL_E2E_INSTANCE=${instance}`,
      'just',
      'local-e2e',
      specFile,
      ...testArgs,
      '--trace',
      'on',
      '--output',
      playwrightDir,
    ],
    runLog
  );
  if (proofExit !== 0) throw new Error('Playwright proof failed');

  traceArchives = (await readdir(playwrightDir, { recursive: true }))
    .filter((path) => path.endsWith('.zip'))
    .map((path) => join(playwrightDir, path));
  const traceSizes = await Promise.all(
    traceArchives.map(async (path) => (await stat(path)).size)
  );
  if (
    traceArchives.length === 0 ||
    traceSizes.some((size) => size === 0)
  ) {
    throw new Error('Playwright did not retain non-empty trace archives');
  }
} finally {
  cleanupExit = await cleanup();
  await writeFile(
    resultPath,
    `${JSON.stringify(
      {
        instance,
        specFile,
        testArgs,
        doctorExit,
        warmupExit,
        proofExit,
        cleanupExit,
        traceArchives,
      },
      null,
      2
    )}\n`
  );
}

if (cleanupExit !== 0) throw new Error('stack cleanup failed');

console.log(`Proof passed: ${proofDir}`);
