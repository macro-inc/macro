import {
  SplitEvent,
  type SplitManager,
} from '@components/app/split-layout/layoutManager';
import { createRoutedSplitLayout } from '@components/app/split-layout/tests/fixtures';
import { createBlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { isImportSessionActive, openImportSession } from './open-session';

const mocks = vi.hoisted(() => ({
  manager: vi.fn<() => SplitManager | undefined>(),
  touch: vi.fn(() => false),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: mocks.touch }));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: mocks.manager,
}));
vi.mock('@core/constant/allBlocks', () => ({
  blocks: { agent: {} },
  resolveBlockAlias: (type: string) => type,
  isBlockAlias: () => false,
}));

function layout(url: string) {
  return createRoot((dispose) => {
    onTestFinished(dispose);
    const manager = createRoutedSplitLayout(createBlockOrchestrator(), url);
    mocks.manager.mockReturnValue(manager);
    return manager;
  });
}

const shown = (manager: SplitManager) =>
  manager.splits().map((split) => split.content.id);
const active = (manager: SplitManager) =>
  manager.splits().find((split) => split.id === manager.activeSplitId())
    ?.content.id;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.touch.mockReturnValue(false);
});

describe('opening the chat that ran an import', () => {
  it('knows the chat is already the active split, and still hands it focus', () => {
    const manager = layout('/agent/import-chat');
    expect(isImportSessionActive('import-chat')).toBe(true);

    openImportSession('import-chat');

    expect(shown(manager)).toEqual(['import-chat']);
    expect(active(manager)).toBe('import-chat');
    expect(manager.events()?.type).toBe(SplitEvent.ReturnFocus);
  });

  it('shows the chat in the active split when another chat is there', () => {
    const manager = layout('/agent/other-chat');
    expect(isImportSessionActive('import-chat')).toBe(false);

    openImportSession('import-chat');

    expect(shown(manager)).toEqual(['import-chat']);
    expect(active(manager)).toBe('import-chat');
    expect(isImportSessionActive('import-chat')).toBe(true);
    expect(manager.events()?.type).toBe(SplitEvent.ReturnFocus);
  });

  it('activates the chat where it already is when another split is active', () => {
    const manager = layout('/agent/import-chat/~/agent/other-chat');
    const other = manager
      .splits()
      .find((split) => split.content.id === 'other-chat');
    if (!other) throw new Error('Fixture split missing');
    manager.activateSplit(other.id);
    expect(isImportSessionActive('import-chat')).toBe(false);

    openImportSession('import-chat');

    expect(shown(manager)).toEqual(['import-chat', 'other-chat']);
    expect(active(manager)).toBe('import-chat');
    expect(isImportSessionActive('import-chat')).toBe(true);
    expect(manager.events()?.type).toBe(SplitEvent.ReturnFocus);
  });

  it('knows the chat in the Agents workspace is the active split', () => {
    const manager = layout('/agents/import-chat');
    expect(isImportSessionActive('import-chat')).toBe(true);

    openImportSession('import-chat');

    expect(manager.splits()).toHaveLength(1);
    expect(manager.events()?.type).toBe(SplitEvent.ReturnFocus);
  });

  it('knows a preview of the chat inside the active split', () => {
    const manager = layout('/agent/other-chat');
    const split = manager.activeSplitId();
    if (!split) throw new Error('Fixture split missing');
    createRoot((dispose) => {
      onTestFinished(dispose);
      onTestFinished(
        manager.registerOpenViews(() => [
          {
            owner: Symbol('inline-preview'),
            split,
            content: { type: 'agent', id: 'import-chat' },
          },
        ])
      );
    });

    expect(isImportSessionActive('import-chat')).toBe(true);
  });

  it('leaves focus alone on touch, where it would raise the keyboard', () => {
    mocks.touch.mockReturnValue(true);
    const manager = layout('/agent/other-chat');

    openImportSession('import-chat');

    expect(active(manager)).toBe('import-chat');
    expect(manager.events()?.type).not.toBe(SplitEvent.ReturnFocus);
  });
});
