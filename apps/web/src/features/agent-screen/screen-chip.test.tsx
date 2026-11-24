import { AppLinkChipContext } from '@core/component/LexicalMarkdown/component/core/app-link-opener';
import { LinkWithPreview } from '@core/component/LexicalMarkdown/component/core/LinkWithPreview';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screenLinkChip } from './screen-chip';

const DEE = '01a1ff9c-c73e-7c62-8c23-20a668f2f355';
const UNKNOWN = '01a1ff9c-0000-7000-8000-000000000000';
const HERE = window.location.origin;

const state = vi.hoisted(() => ({ openWithSplit: vi.fn() }));

vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => ({
    isPending: false,
    isSuccess: true,
    data: [
      {
        id: '01a1ff9c-c73e-7c62-8c23-20a668f2f355',
        team_agent_user_id: 'macro|dee@agents.example',
        access: 'view',
        name: 'Dee computer',
      },
    ],
  }),
}));
vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  getDisplayNameParts: (id: string) =>
    id === 'macro|dee@agents.example'
      ? { firstName: 'Dee', lastName: '', fullName: 'Dee' }
      : { firstName: '', lastName: '', fullName: id },
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: state.openWithSplit }),
}));
vi.mock('@core/signal/unfurl', () => ({ useUnfurl: () => [() => undefined] }));

function Link(props: { url: string; text: string }) {
  return (
    <AppLinkChipContext.Provider value={screenLinkChip}>
      <p>
        See <LinkWithPreview url={props.url}>{props.text}</LinkWithPreview>
      </p>
    </AppLinkChipContext.Provider>
  );
}

describe('the screen chip in a chat message', () => {
  beforeEach(() => state.openWithSplit.mockClear());

  it('draws a link to an agent’s screen as a chip named for the agent', () => {
    render(() => (
      <Link url={`${HERE}/app/screen/${DEE}?mode=drive`} text="my screen" />
    ));
    const chip = screen.getByRole('link', { name: 'Dee’s screen' });
    expect(chip.getAttribute('data-screen-chip')).toBe(DEE);
    // Its own route on this origin, and no request to drive.
    expect(chip.getAttribute('href')).toBe(`/app/screen/${DEE}`);
    expect(screen.queryByText('my screen')).toBeNull();
  });

  it('opens the screen to watch, beside the current split', () => {
    render(() => <Link url={`${HERE}/app/screen/${DEE}`} text="screen" />);
    fireEvent.click(screen.getByRole('link', { name: 'Dee’s screen' }));
    expect(state.openWithSplit).toHaveBeenCalledWith(
      {
        type: 'component',
        id: 'agent-screen',
        params: { harnessId: DEE },
      },
      { preferNewSplit: true }
    );
  });

  it('leaves a modified click to the browser (a new tab on this origin)', () => {
    render(() => <Link url={`${HERE}/app/screen/${DEE}`} text="screen" />);
    fireEvent.click(screen.getByRole('link', { name: 'Dee’s screen' }), {
      metaKey: true,
    });
    expect(state.openWithSplit).not.toHaveBeenCalled();
  });

  it('names a screen the viewer’s list doesn’t have without guessing', () => {
    render(() => <Link url={`${HERE}/app/screen/${UNKNOWN}`} text="screen" />);
    const chip = screen.getByRole('link', { name: 'A computer’s screen' });
    expect(chip.getAttribute('href')).toBe(`/app/screen/${UNKNOWN}`);
  });

  it('keeps a malformed screen link a plain link', () => {
    render(() => (
      <Link url="https://macro.com/app/screen/not-a-harness" text="broken" />
    ));
    const link = screen.getByRole('link', { name: 'broken' });
    expect(link.getAttribute('href')).toBe(
      'https://macro.com/app/screen/not-a-harness'
    );
    expect(link.hasAttribute('data-screen-chip')).toBe(false);
  });

  it('keeps a screen-shaped link on another site a plain link', () => {
    render(() => (
      <Link url={`https://example.com/app/screen/${DEE}`} text="elsewhere" />
    ));
    expect(
      screen.getByRole('link', { name: 'elsewhere' }).getAttribute('href')
    ).toBe(`https://example.com/app/screen/${DEE}`);
  });
});
