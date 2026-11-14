import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createChannel: vi.fn(),
  setPicture: vi.fn(),
  chosenFiles: [] as File[],
  toast: { success: vi.fn(), failure: vi.fn() },
}));

function idleMutation(mutateAsync = vi.fn()) {
  return { isPending: false, mutateAsync };
}

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ replaceOrInsertSplit: vi.fn() }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));
vi.mock('@core/component/Toast/Toast', () => ({ toast: mocks.toast }));
vi.mock('@core/component/RecipientSelector', () => ({
  RecipientSelector: () => <div />,
}));
vi.mock('@core/util/create', () => ({ createStaticFile: vi.fn() }));
vi.mock('@core/util/upload', () => ({
  openFilePicker: (_options: unknown, onFiles: (files: File[]) => void) =>
    onFiles(mocks.chosenFiles),
}));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@queries/channel/channel-bots', () => ({
  useAddBotToChannelMutation: () => idleMutation(),
}));
vi.mock('@queries/channel/channels', () => ({
  useCreateChannelMutation: () => idleMutation(mocks.createChannel),
  usePatchChannelMutation: () => idleMutation(),
}));
vi.mock('@queries/channel/participants', () => ({
  useAddParticipantsMutation: () => idleMutation(),
}));
vi.mock('@queries/channel/picture', () => ({
  useChannelPicture: () => ({ url: () => undefined, isLoading: () => false }),
  useSetChannelPictureMutation: () => idleMutation(mocks.setPicture),
}));
vi.mock('@queries/contacts/recipient-source', () => ({
  useContactRecipientSource: vi.fn(),
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: true,
    data: { team: { id: 'team-1' } },
  }),
}));

// The open state lives in the module, so each test loads a fresh copy.
async function openModal() {
  vi.resetModules();
  const { CreateChannelModal, openNewChannelModal } = await import(
    './CreateChannelModal'
  );
  render(() => <CreateChannelModal />);
  openNewChannelModal();
  fireEvent.input(await screen.findByRole('textbox', { name: 'Name' }), {
    target: { value: 'Design reviews' },
  });
}

function create() {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByText('Private'));
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const picture = new File(['picture'], 'logo.png', { type: 'image/png' });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // The dialog's scroll lock restores the page position as it closes.
  vi.stubGlobal('scrollTo', vi.fn());
  mocks.createChannel.mockResolvedValue({ id: 'channel-1' });
  mocks.setPicture.mockResolvedValue(undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:channel-picture');
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.chosenFiles = [];
});

describe('CreateChannelModal', () => {
  it('uploads the chosen picture to the channel it creates', async () => {
    mocks.chosenFiles = [picture];
    await openModal();

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    create();

    await waitFor(() =>
      expect(mocks.setPicture).toHaveBeenCalledWith({
        channelId: 'channel-1',
        file: picture,
      })
    );
    expect(mocks.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_type: 'private',
        name: 'Design reviews',
      })
    );
  });

  it('creates the channel without a picture once it is removed', async () => {
    mocks.chosenFiles = [picture];
    await openModal();

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();
    create();

    await waitFor(() => expect(mocks.createChannel).toHaveBeenCalled());
    await screen.findByText(/Add people or agents to/);
    expect(mocks.setPicture).not.toHaveBeenCalled();
  });

  it('turns down a file that is not an image before the channel exists', async () => {
    mocks.chosenFiles = [
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    ];
    await openModal();

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(mocks.toast.failure).toHaveBeenCalledWith(
      'Choose a PNG, JPG, WebP, or GIF image'
    );
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });
});
