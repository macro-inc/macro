import { ImperativeDialogHost } from '@app/components/ui/components/ImperativeDialog';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { getOwner, onMount } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationStacksProvider } from '../context/notification-stacks-context';
import { draftFromStack } from '../core/stack';
import { fakeStacksContext, rule, supportStack } from '../tests/stacks';
import { openStackEditor } from './stack-editor-dialog';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

type EditorProps = Parameters<typeof openStackEditor>[0];

const setup = (props: EditorProps = {}) => {
  const fake = fakeStacksContext({ t: 'ready', stacks: [] });
  const Opener = () => {
    const owner = getOwner();
    onMount(() => openStackEditor(props, { owner }));
    return null;
  };
  render(() => (
    <NotificationStacksProvider value={fake.context}>
      <ImperativeDialogHost />
      <Opener />
    </NotificationStacksProvider>
  ));
  return fake;
};

const type = (label: string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
const press = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the stack editor', () => {
  it('refuses a stack with no name, then one that would capture everything', async () => {
    const { stacks } = setup();
    await screen.findByRole('dialog');

    press('Create stack');
    expect(await screen.findByText('Give the stack a name.')).toBeTruthy();

    type('Stack name', 'Everything');
    press('Create stack');
    expect(
      await screen.findByText(
        'Add a place, a person or a kind. A stack with none would capture everything.'
      )
    ).toBeTruthy();
    expect(stacks.create).not.toHaveBeenCalled();
  });

  it('creates a stack that captures channels by name and lets mentions and replies through', async () => {
    const onSaved = vi.fn();
    const { stacks } = setup({ onSaved });
    await screen.findByRole('dialog');

    type('Stack name', ' Support channels ');
    fireEvent.input(screen.getByPlaceholderText('support'), {
      target: { value: 'macro support' },
    });
    press('Add');
    expect(
      await screen.findByText('Channels named “macro support”')
    ).toBeTruthy();
    press('Create stack');

    await waitFor(() =>
      expect(stacks.create).toHaveBeenCalledWith('Support channels', {
        capture: [
          rule({
            sources: [{ type: 'channelNameContains', text: 'macro support' }],
          }),
        ],
        release: [rule({ kinds: ['mention'] }), rule({ kinds: ['reply'] })],
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Support channels' })
    );
  });

  it('stays open and says so when the stack cannot be saved', async () => {
    const { stacks } = setup();
    stacks.create.mockRejectedValueOnce(new Error('offline'));
    await screen.findByRole('dialog');

    type('Stack name', 'Reactions');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reactions' }));
    press('Create stack');

    expect(await screen.findByText('Could not save the stack')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('saves an edit to the stack it was opened for', async () => {
    const stack = supportStack();
    const draft = draftFromStack(stack);
    if (!draft) throw new Error('the support stack is editable');
    const { stacks } = setup({ stack: { id: stack.id, draft } });
    await screen.findByRole('dialog');

    // Stop letting mentions through.
    const released = screen.getByRole('group', {
      name: 'Still notify me about',
    });
    fireEvent.click(
      within(released).getByRole('checkbox', { name: 'Mentions' })
    );
    press('Save');

    await waitFor(() =>
      expect(stacks.update).toHaveBeenCalledWith('stack-support', {
        name: 'Support channels',
        capture: stack.capture,
        release: [],
      })
    );
  });
});
