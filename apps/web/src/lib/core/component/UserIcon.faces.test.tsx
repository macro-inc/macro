import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derivedAgentFace } from '../user/agent-face';
import { UserIcon } from './UserIcon';

const state = vi.hoisted(() => ({
  facesEnabled: true,
  agent: false,
  picture: undefined as
    | {
        loading: boolean;
        url?: string;
        face?: { v: 1; seed: string; pins: Record<string, number> };
      }
    | undefined,
}));

const faces = vi.hoisted(() => ({
  renderFace: vi.fn(
    (face: { seed: string }, _opts?: { size?: number }) =>
      `<svg data-seed="${face.seed}"/>`
  ),
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get ENABLE_AGENT_FACES() {
    return state.facesEnabled;
  },
}));
vi.mock('@macro-inc/agent-faces', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  renderFace: faces.renderFace,
}));
vi.mock('@core/util/open-direct-message', () => ({
  useOpenDirectMessage: () => vi.fn(),
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => undefined,
  getDisplayNameParts: () => ({ firstName: '', lastName: '' }),
  getInitials: () => '?',
  getInitialsFromName: () => 'AB',
  isAgentAccount: () => state.agent,
  macroIdToEmail: (id: string) => id,
  tryMacroId: (id: string) => id,
  useIsConnectedSecondaryInbox: () => () => false,
}));
vi.mock('@core/signal/profilePicture', () => ({
  useProfilePictureUrl: () => [
    () => (state.picture?.loading ? undefined : state.picture?.url),
  ],
  profilePictureItem: () => state.picture,
}));

afterEach(cleanup);

beforeEach(() => {
  state.facesEnabled = true;
  state.agent = false;
  state.picture = { loading: false };
  faces.renderFace.mockClear();
});

const AGENT_ID = 'macro|agent@example.com';

function renderIcon(size?: 'sm' | 'md' | 'lg') {
  const { container } = render(() => (
    <UserIcon
      id={AGENT_ID}
      name="Agent B"
      size={size}
      suppressClick
      showTooltip={false}
    />
  ));
  return {
    image: () => container.querySelector('img')?.getAttribute('src'),
    text: () => container.textContent,
  };
}

const faceSrc = (seed: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg data-seed="${seed}"/>`)}`;

describe('UserIcon agent faces', () => {
  it('draws a saved face, even when a PNG of it is also stored', () => {
    state.picture = {
      loading: false,
      url: 'https://static.example.com/face.png',
      face: { v: 1, seed: 'saved', pins: { hair: 2 } },
    };
    expect(renderIcon().image()).toBe(faceSrc('saved'));
  });

  it('draws a saved face that has no PNG yet', () => {
    state.picture = {
      loading: false,
      face: { v: 1, seed: 'face-only', pins: {} },
    };
    expect(renderIcon().image()).toBe(faceSrc('face-only'));
  });

  it('shows an uploaded photo over the derived agent face', () => {
    state.agent = true;
    state.picture = {
      loading: false,
      url: 'https://static.example.com/photo.png',
    };
    expect(renderIcon().image()).toContain('photo.png');
  });

  it('derives a face from the user id for an agent with no picture', () => {
    state.agent = true;
    expect(renderIcon().image()).toBe(faceSrc(derivedAgentFace(AGENT_ID).seed));
  });

  it('draws a saved copy of the derived face as the same face', () => {
    state.agent = true;
    const derived = renderIcon().image();
    cleanup();
    state.picture = { loading: false, face: derivedAgentFace(AGENT_ID) };
    expect(renderIcon().image()).toBe(derived);
  });

  it('waits for the picture to load before deriving a face', () => {
    state.agent = true;
    state.picture = { loading: true };
    const icon = renderIcon();
    expect(icon.image()).toBeUndefined();
    expect(icon.text()).toContain('AB');
  });

  it('keeps initials for a person with no picture', () => {
    const icon = renderIcon();
    expect(icon.image()).toBeUndefined();
    expect(icon.text()).toContain('AB');
  });

  it('falls back to initials when the face fails to render', () => {
    state.agent = true;
    faces.renderFace.mockImplementationOnce(() => {
      throw new Error('bad part');
    });
    const icon = renderIcon();
    expect(icon.image()).toBeUndefined();
    expect(icon.text()).toContain('AB');
  });

  it('draws faces at the avatar pixel size', () => {
    state.agent = true;
    renderIcon('sm');
    renderIcon('md');
    renderIcon('lg');
    expect(faces.renderFace.mock.calls.map(([, opts]) => opts?.size)).toEqual([
      16, 24, 40,
    ]);
  });

  it('shows the stored picture and no faces when the flag is off', () => {
    state.facesEnabled = false;
    state.agent = true;
    state.picture = {
      loading: false,
      url: 'https://static.example.com/face.png',
      face: { v: 1, seed: 'saved', pins: {} },
    };
    expect(renderIcon().image()).toContain('face.png');

    cleanup();
    state.picture = { loading: false };
    const icon = renderIcon();
    expect(icon.image()).toBeUndefined();
    expect(faces.renderFace).not.toHaveBeenCalled();
  });
});
