import { ImperativeDialogHost } from '@app/components/ui/components/ImperativeDialog';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ComponentProps, ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promptLabelName } from './ChannelLabelNameDialog';
import { promptSectionChannels } from './next/SectionChannelsDialog';
import { promptSection } from './next/SectionDialog';

const confirmSharing = vi.hoisted(() => vi.fn());

const availableChannels = vi.hoisted(() => [
  {
    id: 'first',
    name: 'First',
    channel_type: 'team',
    team_id: 'team',
    is_participant: true,
  },
  {
    id: 'second',
    name: 'Second',
    channel_type: 'team',
    team_id: 'team',
    is_participant: true,
  },
  {
    id: 'existing',
    name: 'Existing',
    channel_type: 'team',
    team_id: 'team',
    is_participant: true,
  },
  {
    id: 'private',
    name: 'Private',
    channel_type: 'private',
    is_participant: true,
  },
  {
    id: 'other-team',
    name: 'Other team',
    channel_type: 'team',
    team_id: 'other',
    is_participant: true,
  },
  {
    id: 'unjoined',
    name: 'Unjoined',
    channel_type: 'team',
    team_id: 'team',
    is_participant: false,
  },
]);
vi.mock('@queries/channel-labels/channel-labels', () => ({
  useAvailableSectionChannelsQuery: () => ({
    isPending: false,
    data: availableChannels,
  }),
  useChannelLabelsQuery: () => ({ isPending: false, data: { teamId: 'team' } }),
}));

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/ImperativeDialog')),
  ...(await import('@app/components/ui/components/Dialog')),
  ...(await import('@app/components/ui/components/Checkbox')),
  ...(await import('@app/components/ui/components/ToggleSwitch')),
  confirmDialog: confirmSharing,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
  Surface: (props: ParentProps) => <div>{props.children}</div>,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Button: (props: ComponentProps<'button'>) => (
    <button type={props.type} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  confirmSharing.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('label naming', () => {
  it('retains the name after failure, prevents duplicate submits, and closes only after saving', async () => {
    render(() => <ImperativeDialogHost />);
    let finish!: () => void;
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('A label with this name already exists'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
    const result = promptLabelName({
      title: 'New label',
      body: 'Private',
      confirmLabel: 'Create label',
      onConfirm,
    });
    const input = screen.getByRole('textbox', {
      name: 'Label name',
    }) as HTMLInputElement;
    fireEvent.input(input, { target: { value: '  My group  ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('already exists')
    );
    expect(input.value).toBe('  My group  ');
    fireEvent.input(input, { target: { value: 'New name' } });
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('dialog', { name: 'New label' })).toBeTruthy();
    finish();
    expect(await result).toBe('New name');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancel never saves, and reopening accepts a fresh name', async () => {
    render(() => <ImperativeDialogHost />);
    const onConfirm = vi.fn(async () => {});
    const props = {
      title: 'New label',
      body: 'Private',
      confirmLabel: 'Create label',
      onConfirm,
    };
    const first = promptLabelName(props);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await first).toBeUndefined();
    expect(onConfirm).not.toHaveBeenCalled();
    const next = promptLabelName(props);
    const input = screen.getByRole('textbox', {
      name: 'Label name',
    }) as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.input(input, { target: { value: 'Second group' } });
    fireEvent.submit(input.closest('form')!);
    expect(await next).toBe('Second group');
    expect(onConfirm).toHaveBeenCalledWith('Second group');
  });
});

describe('section sharing changes', () => {
  it('blocks sharing an existing section with ineligible channels', async () => {
    render(() => <ImperativeDialogHost />);
    const onConfirm = vi.fn(async () => {});
    const dialog = promptSection({
      scope: 'personal',
      canShare: true,
      initial: {
        id: 'section',
        name: 'Section',
        channelIds: ['private'],
        channelCount: 1,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      onConfirm,
    });
    const sharing = screen.getByRole('switch', { name: 'Shared with team' });
    expect(sharing).toHaveProperty('disabled', true);
    fireEvent.click(sharing);
    expect(sharing).toHaveProperty('checked', false);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await dialog;
  });

  it('keeps an unshared edit open when confirmation is cancelled and saves after confirmation', async () => {
    render(() => <ImperativeDialogHost />);
    confirmSharing.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onConfirm = vi.fn(async () => {});
    const dialog = promptSection({
      scope: 'team',
      canShare: true,
      initial: {
        id: 'section',
        name: 'Section',
        teamId: 'team',
        channelIds: ['first'],
        channelCount: 1,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      onConfirm,
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Shared with team' }));
    const save = screen.getByRole('button', { name: 'Save section' });
    fireEvent.click(save);
    await waitFor(() => expect(confirmSharing).toHaveBeenCalledTimes(1));
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(save).toHaveProperty('disabled', false));
    fireEvent.click(save);
    await dialog;
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      name: 'Section',
      scope: 'personal',
    });
  });
});

describe('section channel selection', () => {
  it('offers only eligible additions and retries failed channels without replaying successful additions', async () => {
    render(() => <ImperativeDialogHost />);
    const onConfirm = vi
      .fn()
      .mockResolvedValueOnce(['second'])
      .mockResolvedValueOnce([]);
    const result = promptSectionChannels({
      label: {
        id: 'section',
        name: 'Section',
        teamId: 'team',
        channelIds: ['existing'],
        channelCount: 1,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      onConfirm,
    });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'First' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Second' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 channels' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(onConfirm).toHaveBeenLastCalledWith(['first', 'second']);
    expect(screen.queryByRole('checkbox', { name: 'First' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 channel' }));
    await result;
    expect(onConfirm).toHaveBeenLastCalledWith(['second']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
