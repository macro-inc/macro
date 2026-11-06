import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import compose from '../template/brain.ts';
import { Brain } from './brain.ts';
import { dryRun } from './dry-run.ts';
import { type Candidate, judge, parseJevConfig } from './jev.ts';
import { fixtures, Learning } from './learning.ts';
import type { Turn } from './runner.ts';
import { checkWorkspace } from './supervisor.ts';
import { GitWriter, Workspace } from './workspace.ts';

const candidate: Candidate = {
  messageId: 'useful-message',
  channel: 'operations',
  mentionsMe: false,
  directMessage: false,
  inMyThread: false,
  message: {
    id: 'useful-message',
    from: 'sender',
    at: '2026-11-04T10:00:00Z',
    text: 'Please review the release',
    thread: null,
  },
  recent: [],
};

test('explicit all mode wakes without questions, threshold or a model request', async () => {
  const decision = await judge(candidate, {
    config: async () => parseJevConfig({ mode: 'all' }),
    decide: async () => {
      throw new Error('no model request in all mode');
    },
    log: async () => {},
  });
  assert.equal(decision.relevant, true);
  assert.equal(decision.reason, 'all');
  assert.throws(() => parseJevConfig({ mode: 'all', threshold: 0.5 }));
});

test('decisions, outcomes and human feedback retain a growing regression union across restart', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-learning-'));
  const workspace = new Workspace(root);
  const writer = new GitWriter(workspace, async () => ({
    code: 0,
    stdout: '',
    stderr: '',
  }));
  try {
    const learning = new Learning(workspace, writer);
    await learning.decided(candidate, {
      relevant: true,
      reason: 'all',
      probabilities: {},
    });
    await learning.woke([candidate.messageId]);
    await learning.outcome([candidate.messageId], 'turn', 'success', true);
    await learning.posted('own-message', [candidate.messageId], 'operations');
    await learning.reaction('own-message', true);
    await learning.feedback(
      {
        ...candidate,
        fromCreator: true,
        messageId: 'correction',
        message: { ...candidate.message, text: 'you missed this' },
      },
      candidate.messageId
    );
    assert.equal((await fixtures(root)).length, 1);
    await fs.rm(join(root, 'brain/fixtures'), { recursive: true });
    assert.equal(
      (await fixtures(root)).length,
      1,
      'deleting proposed fixtures cannot erase supervisor regression memory'
    );
    const resumed = new Learning(workspace, writer);
    await resumed.resume();
    assert.equal(resumed.stats().wakeRate, 1);
    assert.equal(await resumed.tuneDue(1), true);
    await resumed.tuned();
    assert.equal(await resumed.tuneDue(1), false);
    const log = await fs.readFile(join(root, 'log/decisions.jsonl'), 'utf8');
    assert.match(log, /positive_reaction/);
    assert.match(log, /missed/);
    assert.match(log, /"posted":true/);
    assert.ok(!log.includes(candidate.message.text));
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('all-event intake uses a cheap tool-free triage turn and preserves mandatory DM admission', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-triage-'));
  const turns: Turn[] = [];
  try {
    await fs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    let brain: Brain | undefined;
    await dryRun(
      (deps) => {
        brain = new Brain(
          {
            ...deps,
            runner: {
              start(turn) {
                turns.push(turn);
                return deps.runner.start(turn);
              },
            },
          },
          {
            learning: { wakesPerTune: 100, triageModel: 'cheap-model' },
          }
        );
        return brain;
      },
      root,
      [
        {
          event_id: 'update',
          event_type: 'document.updated',
          metadata: { document_id: 'doc' },
        },
      ]
    );
    assert.equal(turns.filter((turn) => turn.tier === 'triage').length, 1);
    const triage = turns.find((turn) => turn.tier === 'triage');
    assert.equal(triage?.model, 'cheap-model');
    assert.deepEqual(triage?.builtinTools, []);
    assert.deepEqual(triage?.tools, []);
    assert.equal(triage?.env.BRAIN_CONTROL_TOKEN, undefined);
    assert.equal(turns.filter((turn) => turn.tier === 'respond').length, 1);
    assert.equal(
      (await fixtures(root)).some((fixture) => fixture.candidate.directMessage),
      true
    );
    assert.equal(typeof (await brain?.health())?.wakeRate, 'number');
    assert.match(
      await fs.readFile(join(root, 'log/decisions.jsonl'), 'utf8'),
      /"ignored":true/
    );
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('shipped composition sends the gateway-supported dated Haiku model to triage', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-shipped-triage-'));
  const turns: Turn[] = [];
  try {
    await fs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    await dryRun(
      (deps) =>
        compose({
          ...deps,
          runner: {
            start(turn) {
              turns.push(turn);
              if (turn.tier === 'triage')
                assert.equal(turn.model, 'claude-haiku-4-5-20251001');
              return deps.runner.start(turn);
            },
          },
        }),
      root,
      [
        {
          event_id: 'shipped-triage-update',
          event_type: 'document.updated',
          metadata: { document_id: 'document' },
        },
      ]
    );
    assert.equal(turns.filter((turn) => turn.tier === 'triage').length, 1);
    assert.equal(turns.filter((turn) => turn.tier === 'respond').length, 1);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('brain check rejects narrowing that drops a useful must-wake fixture even when own tests pass', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-regression-'));
  try {
    await fs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    const workspace = new Workspace(root);
    const writer = new GitWriter(workspace, async () => ({
      code: 0,
      stdout: '',
      stderr: '',
    }));
    const learning = new Learning(workspace, writer);
    await learning.decided(candidate, {
      relevant: true,
      reason: 'all',
      probabilities: {},
    });
    await learning.protect(candidate.messageId, 'useful');
    await fs.writeFile(
      join(root, 'brain.ts'),
      `import { Brain, type Composition } from '@macro-inc/brain';
const compose: Composition = deps => new Brain(deps, { triage: () => false });
export default compose;
`
    );
    await fs.writeFile(
      join(root, 'brain/own.test.ts'),
      "import { test } from 'node:test'; test('own tests pass', () => {});\n"
    );
    await assert.rejects(() => checkWorkspace(root), /brain check failed/);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('heartbeat reaction polling records new human reactions once and protects their sources', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-reaction-feedback-'));
  try {
    const { MacroHttp } = await import('./macro.ts');
    const { gatewayHosts } = await import('./config.ts');
    const workspace = new Workspace(root);
    const writer = new GitWriter(workspace, async () => ({
      code: 0,
      stdout: '',
      stderr: '',
    }));
    const learning = new Learning(workspace, writer);
    await learning.decided(candidate, {
      relevant: true,
      reason: 'all',
      probabilities: {},
    });
    await learning.posted('own-message', [candidate.messageId], 'operations');
    const http = new MacroHttp(
      gatewayHosts('https://gateway.invalid'),
      'fake',
      async () =>
        Response.json({
          reactions: [{ emoji: '👍', users: ['human', 'self'] }],
        })
    );
    await learning.pollReactions(http, 'self');
    await learning.pollReactions(http, 'self');
    const log = await fs.readFile(join(root, 'log/decisions.jsonl'), 'utf8');
    assert.equal(
      log.split('\n').filter((line) => line.includes('positive_reaction'))
        .length,
      1
    );
    assert.equal(await learning.isProtected(candidate.messageId), true);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('retained useful event fixtures bypass the cheap model rejection gate', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-protected-triage-'));
  const turns: Turn[] = [];
  try {
    await fs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    await fs.writeFile(
      join(root, 'brain/fixtures/useful.json'),
      JSON.stringify({
        eventType: 'document.updated',
        probabilities: {},
        reason: 'useful',
        candidate: {
          ...candidate,
          messageId: 'update',
          eventType: 'document.updated',
        },
      })
    );
    await dryRun(
      (deps) =>
        new Brain(
          {
            ...deps,
            runner: {
              start(turn) {
                turns.push(turn);
                return deps.runner.start(turn);
              },
            },
          },
          {
            learning: { wakesPerTune: 100, triageModel: 'cheap-model' },
          }
        ),
      root,
      [
        {
          event_id: 'update',
          event_type: 'document.updated',
          metadata: { document_id: 'doc' },
        },
      ]
    );
    assert.equal(
      turns.some((turn) => turn.tier === 'triage'),
      false
    );
    assert.equal(turns.filter((turn) => turn.tier === 'respond').length, 2);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('the template daily onSchedule tune creates a worktree maintenance turn without a report post', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-tune-schedule-'));
  const turns: Turn[] = [];
  try {
    await fs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    const { default: compose } = await import('../template/brain.ts');
    await dryRun(
      (deps) =>
        compose({
          ...deps,
          tasks: {
            create: async () => ({
              id: 'tune-task',
              url: 'https://example.invalid/task',
            }),
          },
          runner: {
            start(turn) {
              turns.push(turn);
              return deps.runner.start(turn);
            },
          },
        }),
      root,
      [
        {
          event_id: 'tune',
          event_type: 'agent_session.opened',
          metadata: {
            identity: {
              session_id: 'routine',
              session_name: 'wake: tune',
              owner_id: 'brain-check',
              source: 'routine',
            },
          },
        },
      ]
    );
    const maintenance = turns.find((turn) => turn.tier === 'work');
    assert.ok(maintenance);
    assert.match(maintenance.cwd, /work\/tune-task$/);
    assert.match(maintenance.prompt, /Run brain check/);
    assert.match(
      maintenance.prompt,
      /merge this branch into main only after check passes/
    );
    const log = await fs.readFile(join(root, 'log/decisions.jsonl'), 'utf8');
    assert.equal(
      log.split('\n').filter((line) => line.includes('"kind":"posted"')).length,
      1
    );
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('permissive intake triages non-routine session events and document comments', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-every-event-'));
  const turns: Turn[] = [];
  try {
    await fs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    await dryRun(
      (deps) =>
        new Brain(
          {
            ...deps,
            runner: {
              start(turn) {
                turns.push(turn);
                return deps.runner.start(turn);
              },
            },
          },
          {
            learning: { wakesPerTune: 100, triageModel: 'cheap-model' },
          }
        ),
      root,
      [
        {
          event_id: 'session',
          event_type: 'agent_session.opened',
          metadata: {
            identity: {
              session_id: 'session',
              session_name: 'ordinary session',
              owner_id: 'another-owner',
              source: 'user',
            },
          },
        },
        {
          event_id: 'comment',
          event_type: 'message.posted',
          metadata: {
            message_id: 'comment',
            content: 'review this document',
            created_at: '2026-11-04T10:00:00Z',
            parent: { type: 'document', id: 'document' },
            root_id: 'comment',
            sender: 'sender',
          },
        },
      ]
    );
    const classified = turns.filter((turn) => turn.tier === 'triage');
    assert.equal(classified.length, 2);
    assert.ok(
      classified.some((turn) => turn.prompt.includes('agent_session.opened'))
    );
    assert.ok(
      classified.some((turn) => turn.prompt.includes('review this document'))
    );
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('creator document comments bypass cheap rejection and become must-wake fixtures', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-creator-comment-'));
  const turns: Turn[] = [];
  try {
    await fs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    const charter = await fs.readFile(join(root, 'OPERATING.md'), 'utf8');
    await fs.writeFile(
      join(root, 'OPERATING.md'),
      charter.replaceAll('{{creator}}', 'creator')
    );
    await dryRun(
      (deps) =>
        new Brain(
          {
            ...deps,
            runner: {
              start(turn) {
                turns.push(turn);
                return deps.runner.start(turn);
              },
            },
          },
          {
            learning: { wakesPerTune: 100, triageModel: 'cheap-model' },
          }
        ),
      root,
      [
        {
          event_id: 'comment-event',
          event_type: 'message.posted',
          metadata: {
            message_id: 'creator-comment',
            content: 'please look here',
            created_at: '2026-11-04T10:00:00Z',
            parent: { type: 'document', id: 'document' },
            root_id: 'creator-comment',
            sender: 'creator',
          },
        },
      ]
    );
    assert.equal(turns.filter((turn) => turn.tier === 'triage').length, 0);
    assert.equal(turns.filter((turn) => turn.tier === 'respond').length, 2);
    assert.ok(
      (await fixtures(root)).some(
        (fixture) =>
          fixture.candidate.messageId === 'creator-comment' &&
          fixture.candidate.fromCreator
      )
    );
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('messages from other bots are judged instead of silently prefiltered', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-bot-admission-'));
  try {
    await fs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    await dryRun(
      (deps) =>
        new Brain(deps, {
          async onEvent(event, brain) {
            if (event.type === 'message.posted')
              await brain.onMessage({
                ...event.metadata,
                message_id: 'bot-message',
                sender: 'bot|service',
                content: 'automated update',
              });
          },
        }),
      root
    );
    assert.ok(
      (await fixtures(root)).some(
        (fixture) =>
          fixture.candidate.messageId === 'bot-message' &&
          fixture.candidate.directMessage
      )
    );
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('creator reports protect a referenced cached message outside the recent context', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-missed-context-'));
  try {
    await fs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    await fs.writeFile(
      join(root, 'OPERATING.md'),
      (await fs.readFile(join(root, 'OPERATING.md'), 'utf8')).replaceAll(
        '{{creator}}',
        'creator'
      )
    );
    const workspace = new Workspace(root);
    const writer = new GitWriter(workspace, async () => ({
      code: 0,
      stdout: '',
      stderr: '',
    }));
    await new Learning(workspace, writer).decided(candidate, {
      relevant: false,
      reason: 'deterministic',
      probabilities: {},
    });
    await dryRun((deps) => new Brain(deps), root, [
      {
        event_id: 'missed-report',
        event_type: 'message.posted',
        metadata: {
          message_id: 'report',
          content: 'you missed this',
          created_at: '2026-11-04T10:00:00Z',
          parent: { type: 'channel', id: 'check' },
          root_id: candidate.messageId,
          thread_id: candidate.messageId,
          sender: 'creator',
        },
      },
    ]);
    assert.ok(
      (await fixtures(root)).some(
        (fixture) =>
          fixture.candidate.messageId === candidate.messageId &&
          fixture.reason === 'missed'
      )
    );
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
