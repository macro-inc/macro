import * as nodeFs from 'node:fs/promises';
// The persona workspace: a git checkout of the agent's repo. Persona files are
// read fresh for every turn (the agent edits them); every write and commit
// goes through one serial writer so two turns never race on the index.
import { join } from 'node:path';
import { SpanStatusCode } from '@opentelemetry/api';
import { type Budget, parseBudget } from './budget.ts';
import { type EventsConfig, parseEventsConfig } from './events-config.ts';
import { type JevConfig, parseJevConfig } from './jev.ts';
import { readStyle } from './style.ts';
import { runCommand } from './subprocess.ts';
import { traceHeaders, withSpan } from './telemetry.ts';
/** Paths the repo must never commit: raw history, logs, caches, secrets. */
export const IGNORED = [
  'history/',
  'log/',
  'cache/',
  'work/',
  'secrets',
  'secrets.*',
  '*.secret',
  '*.brain-tmp',
  'node_modules/',
];
export type Persona = {
  operating: string;
  prompts: {
    respond: string;
    heartbeat: string;
    work: string;
  };
  jev: JevConfig;
  events: EventsConfig;
  budget: Budget;
  brainLock: string;
};
export class WorkspaceError extends Error {}
export class Workspace {
  readonly root: string;
  private readonly configurationRoot: string;
  constructor(root: string, configurationRoot = root) {
    this.root = root;
    this.configurationRoot = configurationRoot;
  }
  private readConfiguration(relative: string): Promise<string> {
    return nodeFs.readFile(join(this.configurationRoot, relative), 'utf8');
  }
  path(...parts: string[]): string {
    return join(this.root, ...parts);
  }
  async read(relative: string): Promise<string> {
    try {
      return await nodeFs.readFile(this.path(relative), 'utf8');
    } catch (error) {
      throw new WorkspaceError(`could not read ${relative}: ${String(error)}`);
    }
  }
  /** Every persona file, parsed and validated. A broken file fails the turn that needs it. */
  async persona(): Promise<Persona> {
    const json = async (relative: string) => {
      const text = await this.readConfiguration(relative);
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new WorkspaceError(`${relative} is not JSON: ${String(error)}`);
      }
    };
    let notice = '';
    try {
      notice = await nodeFs.readFile(
        this.path('cache', 'rewiring-notice'),
        'utf8'
      );
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        throw error;
    }
    return {
      operating: `${await this.read('OPERATING.md')}\n${await readStyle(this.path('prompts/style'))}\n${notice}`,
      prompts: {
        respond: await this.read('prompts/respond.md'),
        heartbeat: await this.read('prompts/heartbeat.md'),
        work: await this.read('prompts/work.md'),
      },
      jev: parseJevConfig(await json('config/jev.json')),
      events: parseEventsConfig(await json('config/events.json')),
      budget: parseBudget(await json('config/budget.json')),
      brainLock: (await this.readConfiguration('brain.lock')).trim(),
    };
  }
  /** Jev policy from the supervisor's checked configuration snapshot. */
  async jev(): Promise<JevConfig> {
    const text = await this.readConfiguration('config/jev.json');
    try {
      return parseJevConfig(JSON.parse(text));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new WorkspaceError(
          `config/jev.json is not JSON: ${error.message}`
        );
      throw error;
    }
  }
  /** Make sure `.gitignore` names every path in `IGNORED`; returns whether it changed. */
  async enforceGitignore(): Promise<boolean> {
    const file = this.path('.gitignore');
    let current = '';
    try {
      current = await nodeFs.readFile(file, 'utf8');
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        throw error;
    }
    const lines = new Set(current.split('\n').map((line) => line.trim()));
    const absent = IGNORED.filter((entry) => !lines.has(entry));
    if (absent.length === 0) return false;
    const prefix =
      current === '' || current.endsWith('\n') ? current : `${current}\n`;
    await nodeFs.writeFile(file, `${prefix}${absent.join('\n')}\n`);
    return true;
  }
}
export type GitResult = {
  code: number;
  stdout: string;
  stderr: string;
};
export type Git = (args: string[]) => Promise<GitResult>;
/**
 * Run git in `cwd` with the CLI, with PATH, HOME and the repo credentials from the brain's
 * environment (only git receives the repo token; the adapter never
 * inherits loader variables or service secrets).
 */
export function gitCli(
  cwd: string,
  readEnv: (name: string) => string | undefined = (name) => process.env[name]
): Git {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
  for (const name of ['PATH', 'HOME', 'MACRO_REPO_URL', 'MACRO_REPO_TOKEN']) {
    const value = readEnv(name);
    if (value) env[name] = value;
  }
  return async (args) => {
    const parent = traceHeaders().traceparent;
    const traceEnv: Record<string, string> = parent
      ? {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'http.extraHeader',
          GIT_CONFIG_VALUE_0: `traceparent: ${parent}`,
        }
      : {};
    const output = await runCommand('git', {
      args: ['-C', cwd, ...args],
      stdout: 'piped',
      stderr: 'piped',
      clearEnv: true,
      env: { ...env, ...traceEnv },
    });
    const decoder = new TextDecoder();
    return {
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  };
}
export type CommitOutcome = 'clean' | 'pushed' | 'push-failed';
/**
 * The single writer: file writes and commits run one at a time, in order.
 * A rejected push pulls with rebase and pushes again, up to `pushAttempts`.
 */
export class GitWriter {
  private readonly workspace: Workspace;
  private readonly git: Git;
  private readonly pushAttempts;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(workspace: Workspace, git: Git, pushAttempts = 3) {
    this.workspace = workspace;
    this.git = git;
    this.pushAttempts = pushAttempts;
  }
  private serial<Result>(step: () => Promise<Result>): Promise<Result> {
    const next = this.tail.then(step);
    this.tail = next.catch(() => undefined);
    return next;
  }
  /** Write a workspace file in order with every other write and commit. */
  write(relative: string, content: string): Promise<void> {
    return this.serial(async () => {
      const file = this.workspace.path(relative);
      await nodeFs.mkdir(join(file, '..'), { recursive: true });
      const temporary = `${file}.${crypto.randomUUID()}.brain-tmp`;
      try {
        await nodeFs.writeFile(temporary, content, { flag: 'wx' });
        await nodeFs.rename(temporary, file);
      } finally {
        await nodeFs.rm(temporary, { force: true });
      }
    });
  }
  /** Delete a workspace file; deleting a missing file is a no-op. */
  remove(relative: string): Promise<void> {
    return this.serial(async () => {
      try {
        await nodeFs.rm(this.workspace.path(relative));
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        )
          throw error;
      }
    });
  }
  /** Commit everything as `turn <id>: <summary>` and push. */
  commitTurn(turnId: string, summary: string): Promise<CommitOutcome> {
    const firstLine = summary.split('\n')[0]?.trim() || 'no summary';
    return this.commit(`turn ${turnId}: ${firstLine.slice(0, 120)}`);
  }
  commit(message: string): Promise<CommitOutcome> {
    return withSpan('brain.git.commit_push', {}, async (span) =>
      this.serial(async () => {
        await this.workspace.enforceGitignore();
        await this.must(['add', '-A']);
        const staged = await this.git(['diff', '--cached', '--quiet']);
        if (staged.code !== 0) {
          await this.must([
            '-c',
            'commit.gpgsign=false',
            'commit',
            '-q',
            '-m',
            message,
          ]);
        }
        const ahead = await this.git(['rev-list', '--count', '@{u}..HEAD']);
        if (ahead.code === 0 && ahead.stdout.trim() === '0') return 'clean';
        for (let attempt = 0; attempt < this.pushAttempts; attempt++) {
          const pushed = await this.git(['push', '-q', 'origin', 'HEAD']);
          span.setAttribute('git.push.attempt', attempt + 1);
          if (pushed.code === 0) return 'pushed';
          const rebased = await this.git(['pull', '--rebase', '-q']);
          if (rebased.code !== 0) {
            await this.git(['rebase', '--abort']);
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.setAttribute('error.type', 'push_failed');
            return 'push-failed';
          }
        }
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute('error.type', 'push_failed');
        return 'push-failed';
      })
    );
  }
  private async must(args: string[]): Promise<void> {
    const result = await this.git(args);
    if (result.code !== 0) {
      throw new WorkspaceError(
        `git ${args.join(' ')} failed: ${result.stderr.trim()}`
      );
    }
  }
}
