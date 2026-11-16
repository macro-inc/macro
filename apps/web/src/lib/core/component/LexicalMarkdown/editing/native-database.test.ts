import { textLeaf } from '@macro-inc/lexical-wasm-view/view/dom';
import { createRoot } from 'solid-js';
import 'fake-indexeddb/auto';
import {
  initializeInputCommitFixture,
  mountInputCommitFixture,
  seedInputCommitFixture,
} from '@macro-inc/lexical-wasm-view/view/input-commit-test-fixture';
import { err, ok, type Result } from 'neverthrow';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { ACTIONS } from '../plugins/actions/actions';
import { dispatchApplicationCommandSettledIfSessionEdit } from '../plugins/group-b/command';
import { installDatabaseFixtureViews } from './database-browser-test/fixture-views';
import { createNativeActionMenuHost } from './overlay-hosts/native-actions';
import { createNativeDatabaseController } from './overlay-hosts/native-database';

const service = vi.hoisted(() => ({
  create: vi.fn(),
  track: vi.fn(),
  untrack: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@queries/storage/databases', () => ({
  createDatabase: service.create,
}));
vi.mock('@core/signal/mention', () => ({
  trackMention: service.track,
  untrackMention: service.untrack,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: service.toast },
}));
let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeInputCommitFixture();
});
afterAll(() => restore?.());
beforeEach(() => {
  vi.clearAllMocks();
  service.create.mockResolvedValue(ok('fixture-database'));
  service.track.mockResolvedValue('fixture-mention');
  service.untrack.mockResolvedValue(undefined);
});

async function fixture() {
  const owned = createRoot((dispose) => {
    const runtime = mountInputCommitFixture();
    const releaseViews = installDatabaseFixtureViews(runtime.view);
    return { runtime, releaseViews, dispose };
  });
  const { runtime, releaseViews } = owned;
  await seedInputCommitFixture(runtime);
  const controller = createNativeDatabaseController(runtime.view);
  return {
    ...runtime,
    controller,
    async close() {
      controller.dispose();
      releaseViews();
      try {
        await runtime.close();
      } finally {
        owned.dispose();
        runtime.root.remove();
      }
    },
  };
}
const context = {
  sourceDocumentId: 'fixture-document',
  sourceBlockName: 'md',
  disableMentionTracking: false,
};
function awaitKey(runtime: Awaited<ReturnType<typeof fixture>>) {
  const pending = [...runtime.view.mirror.values()].find(
    (node) => node.type === 'await'
  );
  if (!pending) throw new Error('Missing actual native Await');
  return pending.key;
}

test('the native slash catalog exposes Database only with its real request installed', async () => {
  const runtime = await fixture();
  const item = ACTIONS.find((item) => item.id === 'database');
  if (!item) throw new Error('Missing Source Database action');
  const host = createNativeActionMenuHost(
    runtime.view,
    { requestTable() {}, requestDatabase: runtime.controller.requestDatabase },
    () => true
  );
  const absent = createNativeActionMenuHost(
    runtime.view,
    { requestTable() {} },
    () => true
  );
  try {
    expect(host.supports(item)).toBe(true);
    expect(absent.supports(item)).toBe(false);
  } finally {
    host.dispose();
    absent.dispose();
    await runtime.close();
  }
});

test('keeps the original Await anchor when the caret moves to another paragraph', async () => {
  const runtime = await fixture();
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: 'Before. After.' }],
          },
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: 'Elsewhere' }],
          },
        ],
      },
    })
  );
  const original = [...runtime.view.mirror.values()].find(
    (node) => node.type === 'text' && node.text === 'Before. After.'
  );
  if (!original) throw new Error('Missing original insertion text');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: original.key, type: 'text', offset: 8 },
    focus: { key: original.key, type: 'text', offset: 8 },
  });
  const createEntered = Promise.withResolvers<void>();
  const created = Promise.withResolvers<Result<string, unknown>>();
  service.create.mockImplementation(() => {
    awaitKey(runtime);
    createEntered.resolve();
    return created.promise;
  });
  service.track.mockImplementation(async () => {
    awaitKey(runtime);
    return 'fixture-mention';
  });
  try {
    const request = runtime.controller.requestDatabase(context);
    await createEntered.promise;
    expect(service.create).toHaveBeenCalledOnce();
    const elsewhere = [...runtime.view.mirror.values()].find(
      (node) => node.type === 'text' && node.text === 'Elsewhere'
    );
    if (!elsewhere) throw new Error('Missing second paragraph caret');
    const moved = {
      kind: 'range',
      anchor: { key: elsewhere.key, type: 'text', offset: 4 },
      focus: { key: elsewhere.key, type: 'text', offset: 4 },
    } as const;
    const leaf = textLeaf(runtime.view.getElementByKey(elsewhere.key));
    const domSelection = window.getSelection();
    if (!leaf || !domSelection) throw new Error('Missing actual DOM caret');
    domSelection.setBaseAndExtent(leaf, 4, leaf, 4);
    runtime.port.selectionFromView(moved);
    created.resolve(ok('fixture-database'));
    await request;
    expect(service.create).toHaveBeenCalledWith({
      name: 'Untitled database',
      source: 'slash-menu',
    });
    expect(service.track).toHaveBeenCalledWith(
      'fixture-document',
      'database',
      'fixture-database'
    );
    expect(service.untrack).not.toHaveBeenCalled();
    expect(
      [...runtime.view.mirror.values()].filter((node) => node.type === 'await')
    ).toHaveLength(0);
    expect(
      [...runtime.view.mirror.values()].filter(
        (node) => node.type === 'document-card'
      )
    ).toHaveLength(1);
    expect(
      runtime.view.node(0)?.children.map((key) => runtime.view.node(key)?.type)
    ).toEqual(['paragraph', 'document-card', 'paragraph', 'paragraph']);
    expect(runtime.view.selection().selection).toMatchObject(moved);
  } finally {
    await runtime.close();
  }
});

for (const stage of ['create', 'track'] as const) {
  test(`removing the Await during ${stage} never inserts elsewhere or leaves a tracked mention`, async () => {
    const runtime = await fixture();
    const blocked = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    service[stage].mockImplementation(async () => {
      entered.resolve();
      await blocked.promise;
      return stage === 'create' ? ok('fixture-database') : 'fixture-mention';
    });
    try {
      const request = runtime.controller.requestDatabase(context);
      await entered.promise;
      const key = awaitKey(runtime);
      await dispatchApplicationCommandSettledIfSessionEdit(
        runtime.view,
        'group-b.database-remove-any',
        () => ({ key })
      );
      blocked.resolve();
      await request;
      expect(
        [...runtime.view.mirror.values()].some(
          (node) => node.type === 'document-card'
        )
      ).toBe(false);
      if (stage === 'create') expect(service.track).not.toHaveBeenCalled();
      else
        expect(service.untrack).toHaveBeenCalledWith(
          'fixture-document',
          'fixture-mention'
        );
    } finally {
      blocked.resolve();
      await runtime.close();
    }
  });
}

test('a failed create removes only the owned pending node and reports Source failure', async () => {
  const runtime = await fixture();
  service.create.mockResolvedValue(err('fixture-create-failure'));
  try {
    await runtime.controller.requestDatabase(context);
    expect(service.toast).toHaveBeenCalledWith(
      'Your database could not be created. Try again.'
    );
    expect(
      [...runtime.view.mirror.values()].some((node) => node.type === 'await')
    ).toBe(false);
    expect(service.track).not.toHaveBeenCalled();
  } finally {
    await runtime.close();
  }
});

for (const stage of ['create', 'track'] as const) {
  test(`editability lost during ${stage} cleans the original Await and mention`, async () => {
    const runtime = await fixture();
    const blocked = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    service[stage].mockImplementation(async () => {
      entered.resolve();
      await blocked.promise;
      return stage === 'create' ? ok('fixture-database') : 'fixture-mention';
    });
    try {
      const request = runtime.controller.requestDatabase(context);
      await entered.promise;
      runtime.view.setEditable(false);
      blocked.resolve();
      await request;
      expect(
        [...runtime.view.mirror.values()].some(
          (node) => node.type === 'await' || node.type === 'document-card'
        )
      ).toBe(false);
      if (stage === 'track')
        expect(service.untrack).toHaveBeenCalledWith(
          'fixture-document',
          'fixture-mention'
        );
      else expect(service.track).not.toHaveBeenCalled();
    } finally {
      blocked.resolve();
      await runtime.close();
    }
  });
}

for (const stage of ['create', 'track'] as const) {
  test(`retiring the controller during ${stage} never writes a replacement`, async () => {
    const runtime = await fixture();
    const entered = Promise.withResolvers<void>();
    const blocked = Promise.withResolvers<void>();
    service[stage].mockImplementation(async () => {
      entered.resolve();
      await blocked.promise;
      return stage === 'create' ? ok('fixture-database') : 'fixture-mention';
    });
    try {
      const request = runtime.controller.requestDatabase(context);
      await entered.promise;
      runtime.controller.dispose();
      blocked.resolve();
      await request;
      expect(
        [...runtime.view.mirror.values()].some(
          (node) => node.type === 'document-card'
        )
      ).toBe(false);
      if (stage === 'track')
        expect(service.untrack).toHaveBeenCalledWith(
          'fixture-document',
          'fixture-mention'
        );
      else expect(service.track).not.toHaveBeenCalled();
    } finally {
      blocked.resolve();
      await runtime.close();
    }
  });
}

test('a tracking failure cleans its Await and shows the Source insert-error toast', async () => {
  const runtime = await fixture();
  service.track.mockRejectedValue(new Error('fixture tracking failure'));
  try {
    await runtime.controller.requestDatabase(context);
    expect(
      [...runtime.view.mirror.values()].some(
        (node) => node.type === 'await' || node.type === 'document-card'
      )
    ).toBe(false);
    expect(service.toast).toHaveBeenCalledWith(
      'The database could not be inserted. Try again.'
    );
    expect(service.untrack).not.toHaveBeenCalled();
  } finally {
    await runtime.close();
  }
});

test('a later consumer error cannot turn a committed card into failed insertion cleanup', async () => {
  const runtime = await fixture();
  let fail = true;
  const release = runtime.view.onCommit(() => {
    if (
      fail &&
      [...runtime.view.mirror.values()].some(
        (node) => node.type === 'document-card'
      )
    ) {
      fail = false;
      throw new Error('fixture card consumer failure');
    }
  });
  try {
    await runtime.controller.requestDatabase(context);
    expect(service.track).toHaveBeenCalledOnce();
    expect(service.untrack).not.toHaveBeenCalled();
    expect(service.toast).toHaveBeenCalledWith(
      'The database could not be inserted. Try again.'
    );
  } finally {
    release();
    await runtime.close();
  }
});

test('an untracking failure still reports the Source outer insertion failure', async () => {
  const runtime = await fixture();
  const entered = Promise.withResolvers<void>();
  const blocked = Promise.withResolvers<void>();
  service.track.mockImplementation(async () => {
    entered.resolve();
    await blocked.promise;
    return 'fixture-mention';
  });
  service.untrack.mockRejectedValue(new Error('fixture untracking failure'));
  try {
    const request = runtime.controller.requestDatabase(context);
    await entered.promise;
    const key = awaitKey(runtime);
    await dispatchApplicationCommandSettledIfSessionEdit(
      runtime.view,
      'group-b.database-remove-any',
      () => ({ key })
    );
    blocked.resolve();
    await request;
    expect(service.toast).toHaveBeenCalledWith(
      'The database could not be inserted. Try again.'
    );
    expect(
      [...runtime.view.mirror.values()].some(
        (node) => node.type === 'await' || node.type === 'document-card'
      )
    ).toBe(false);
  } finally {
    blocked.resolve();
    await runtime.close();
  }
});

test('a persistently throwing card consumer cannot prevent view disposal and native free', async () => {
  const runtime = await fixture();
  const fault = new Error('fixture persistent card consumer');
  const free = vi.spyOn(runtime.executor.session, 'free');
  const release = runtime.view.onCommit(() => {
    if (
      [...runtime.view.mirror.values()].some(
        (node) => node.type === 'document-card'
      )
    )
      throw fault;
  });
  try {
    await runtime.controller.requestDatabase(context);
    expect(service.untrack).not.toHaveBeenCalled();
    // Close may preserve the consumer's error, but must finish releasing ownership.
    const closeError = await runtime.close().then(
      () => undefined,
      (error: unknown) => error
    );
    if (closeError !== undefined) expect(closeError).toBe(fault);
    expect(runtime.view.isMounted).toBe(false);
    expect(free).toHaveBeenCalledOnce();
  } finally {
    release();
  }
});

test('overlapping creates retain distinct Await ownership when completion order reverses', async () => {
  const runtime = await fixture();
  const first = Promise.withResolvers<Result<string, unknown>>();
  const second = Promise.withResolvers<Result<string, unknown>>();
  const bothEntered = Promise.withResolvers<void>();
  let count = 0;
  service.create.mockImplementation(() => {
    count++;
    if (count === 2) bothEntered.resolve();
    return count === 1 ? first.promise : second.promise;
  });
  try {
    const one = runtime.controller.requestDatabase();
    const two = runtime.controller.requestDatabase();
    await bothEntered.promise;
    expect(
      [...runtime.view.mirror.values()].filter((node) => node.type === 'await')
    ).toHaveLength(2);
    second.resolve(ok('fixture-second-database'));
    await two;
    first.resolve(ok('fixture-first-database'));
    await one;
    expect(
      [...runtime.view.mirror.values()].filter(
        (node) => node.type === 'document-card'
      )
    ).toHaveLength(2);
    expect(
      [...runtime.view.mirror.values()].filter((node) => node.type === 'await')
    ).toHaveLength(0);
    expect(service.untrack).not.toHaveBeenCalled();
  } finally {
    first.resolve(ok('fixture-first-database'));
    second.resolve(ok('fixture-second-database'));
    await runtime.close();
  }
});
