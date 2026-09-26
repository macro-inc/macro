import { QueryClient, useQuery } from '@tanstack/solid-query';
import { createRoot, createSignal, onCleanup } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  createPreview: undefined as (() => () => unknown) | undefined,
  preview: undefined as (() => unknown) | undefined,
  channelName: undefined as (() => string) | undefined,
  previewMounts: 0,
  previewDisposals: 0,
  channelMounts: 0,
  projectsEnabled: undefined as (() => boolean) | undefined,
  projectMounts: 0,
  projectDisposals: 0,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: fixture.projectsEnabled?.() ?? false,
  }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableProjects: { key: 'enable-projects' },
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('../../projects/queries/project-identity', () => ({
  useProjectIdentityQuery: () => {
    fixture.projectMounts++;
    onCleanup(() => fixture.projectDisposals++);
    return {
      isError: false,
      isPending: false,
      data: { id: 'entity-1', name: 'Launch' },
    };
  },
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (type: string) => type,
}));
vi.mock('../utils', () => ({
  entityTypeToItemType: (type: string) => type.toLowerCase(),
}));
vi.mock('@core/context/channels', () => ({
  useChannelName: () => {
    fixture.channelMounts++;
    return () => fixture.channelName?.() ?? '';
  },
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => '',
  tryMacroId: () => undefined,
}));
vi.mock('@queries/preview', () => ({
  useItemPreview: () => {
    fixture.previewMounts++;
    onCleanup(() => fixture.previewDisposals++);
    return [fixture.createPreview?.() ?? (() => fixture.preview?.())];
  },
  isAccessiblePreviewItem: (item: { access?: string }) =>
    item.access === 'access',
}));

import { createLivePreviewBatcher } from '@queries/preview/live-batcher';
import { usePropertyEntityDisplay } from './usePropertyEntityDisplay';

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  fixture.createPreview = undefined;
  fixture.preview = undefined;
  vi.useRealTimers();
  fixture.channelName = undefined;
  fixture.previewMounts = 0;
  fixture.previewDisposals = 0;
  fixture.channelMounts = 0;
  fixture.projectsEnabled = undefined;
  fixture.projectMounts = 0;
  fixture.projectDisposals = 0;
});

function setup(type: 'DOCUMENT' | 'CHANNEL' | 'INITIATIVE') {
  return createRoot((dispose) => {
    disposals.push(dispose);
    return usePropertyEntityDisplay(
      () => 'entity-1',
      () => type
    );
  });
}

describe('usePropertyEntityDisplay subscription ownership', () => {
  it('only owns project identity queries and links while the rollout is enabled', () => {
    const [enabled, setEnabled] = createSignal(false);
    fixture.projectsEnabled = enabled;
    const display = setup('INITIATIVE');
    expect(fixture.projectMounts).toBe(0);
    expect(display.nativeProjectId()).toBeUndefined();

    setEnabled(true);
    expect(fixture.projectMounts).toBe(1);
    expect(display.nativeProjectId()).toBe('entity-1');
    expect(display.name()).toBe('Launch');

    setEnabled(false);
    expect(fixture.projectDisposals).toBe(1);
    expect(display.nativeProjectId()).toBeUndefined();
    expect(display.blockOrFileType()).toBeNull();
  });

  it('settles a live GraphQL preview batch without reacquiring itself', () => {
    vi.useFakeTimers();
    let starts = 0;
    const queryClient = new QueryClient();
    const disposeBatch = vi.fn();
    const batcher = createLivePreviewBatcher<string, unknown>({
      start: () => {
        // Bound the synchronous drain: a regression must fail instead of hanging the suite.
        if (++starts > 5) throw new Error('preview subscription feedback loop');
        return {
          value: {
            loading: false,
            access: 'access',
            name: 'Roadmap',
            fileType: 'md',
          },
          dispose: disposeBatch,
        };
      },
    });
    fixture.createPreview = () => {
      const [preview, setPreview] = createSignal<unknown>();
      const subscription = batcher.acquire('entity-1', 'entity-1', setPreview);
      onCleanup(subscription.dispose);
      // The real preview hook also constructs a disabled REST fallback.
      // TanStack reads these options during construction, before any result.
      useQuery(
        () => ({
          queryKey: ['preview-rest-fallback', Boolean(preview())],
          queryFn: async () => null,
          enabled: false,
        }),
        () => queryClient
      );
      return preview;
    };
    const display = setup('DOCUMENT');
    vi.advanceTimersByTime(30);
    expect(display.name()).toBe('Roadmap');
    expect(display.isLoading()).toBe(false);
    expect(starts).toBe(1);
    disposals.pop()?.();
    queryClient.clear();
    expect(disposeBatch).toHaveBeenCalledTimes(1);
  });

  it('keeps the preview subscription while loading and receiving live updates', () => {
    const [preview, setPreview] = createSignal<unknown>({ loading: true });
    fixture.preview = preview;
    const display = setup('DOCUMENT');
    expect(display.isLoading()).toBe(true);
    expect(fixture.previewMounts).toBe(1);

    setPreview({
      loading: false,
      access: 'access',
      name: 'Roadmap',
      fileType: 'md',
    });
    expect(display.name()).toBe('Roadmap');
    expect(display.blockOrFileType()).toBe('md');
    expect(display.isLoading()).toBe(false);
    expect(fixture.previewMounts).toBe(1);
    expect(fixture.previewDisposals).toBe(0);

    setPreview({
      loading: false,
      access: 'access',
      name: 'Updated roadmap',
      fileType: 'pdf',
    });
    expect(display.name()).toBe('Updated roadmap');
    expect(display.blockOrFileType()).toBe('pdf');
    expect(fixture.previewMounts).toBe(1);
    disposals.pop()?.();
    expect(fixture.previewDisposals).toBe(1);
  });

  it('keeps the channel subscription when its name changes', () => {
    const [name, setName] = createSignal('Design');
    fixture.channelName = name;
    const display = setup('CHANNEL');
    expect(display.name()).toBe('Design');
    setName('Product design');
    expect(display.name()).toBe('Product design');
    expect(fixture.channelMounts).toBe(1);
  });
});
