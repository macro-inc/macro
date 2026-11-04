import { fireEvent, render, screen } from '@solidjs/testing-library';
import { openDialog } from '@ui/components/ImperativeDialog';
import { createComponent, createRoot, createSignal, onCleanup } from 'solid-js';
import { spread } from 'solid-js/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceDialog } from './appearance-dialog';
import {
  EntityAppearanceTrigger,
  useChangeEntityIcon,
} from './entity-appearance';

const flag = vi.hoisted(() => ({
  enabled: (): boolean => true,
  mounted: vi.fn(),
  unmounted: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: flag.enabled() }),
}));
vi.mock('@core/constant/featureFlags', async (original) => ({
  ...(await original<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: () => flag.enabled(),
}));
vi.mock('./views/appearance-editor', () => ({
  AppearanceEditor: () => {
    flag.mounted();
    onCleanup(flag.unmounted);
    return null;
  },
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'editor' }));
vi.mock('@ui/components/ImperativeDialog', () => ({ openDialog: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  flag.enabled = () => true;
});

const DOCUMENT = {
  type: 'document' as const,
  id: 'document',
  ownerId: 'editor',
  name: 'Note',
  fileType: 'md',
};

describe('header icon editing', () => {
  it('opens the editor without triggering surrounding header navigation', () => {
    const navigate = vi.fn();
    const container = document.createElement('div');
    spread(container, { onClick: navigate });
    document.body.append(container);
    render(
      () =>
        createComponent(EntityAppearanceTrigger, {
          entity: DOCUMENT,
          editable: true,
        }),
      { container }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change icon' }));
    expect(openDialog).toHaveBeenCalledOnce();
    expect(vi.mocked(openDialog).mock.calls[0][1]).toMatchObject({
      entity: DOCUMENT,
      userId: 'editor',
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps read-only header icons non-editable', () => {
    render(() =>
      createComponent(EntityAppearanceTrigger, {
        entity: DOCUMENT,
        editable: false,
      })
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(openDialog).not.toHaveBeenCalled();
  });

  it('checks the current rollout before a captured launcher opens the editor', () => {
    const [enabled, setEnabled] = createSignal(false);
    flag.enabled = enabled;
    createRoot((dispose) => {
      const changeIcon = useChangeEntityIcon();
      changeIcon(DOCUMENT);
      expect(openDialog).not.toHaveBeenCalled();
      setEnabled(true);
      changeIcon(DOCUMENT);
      expect(openDialog).toHaveBeenCalledOnce();
      setEnabled(false);
      changeIcon(DOCUMENT);
      expect(openDialog).toHaveBeenCalledOnce();
      dispose();
    });
  });

  it('disposes an open editor when the remote rollout is disabled', () => {
    const [enabled, setEnabled] = createSignal(true);
    flag.enabled = enabled;
    const onOpenChange = vi.fn();
    render(() =>
      createComponent(AppearanceDialog, {
        entity: DOCUMENT,
        userId: 'editor',
        open: true,
        onOpenChange,
        isCurrent: () => true,
      })
    );
    expect(flag.mounted).toHaveBeenCalledOnce();
    setEnabled(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(flag.unmounted).toHaveBeenCalledOnce();
  });
});
