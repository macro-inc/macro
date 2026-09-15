import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { SessionStartToggle } from './SessionStartToggle';

vi.mock('@ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ui')>();
  const Pass = (props: { children?: import('solid-js').JSX.Element }) =>
    props.children;
  return {
    ...actual,
    Dropdown: Object.assign(Pass, {
      Trigger: (
        props: import('solid-js').JSX.ButtonHTMLAttributes<HTMLButtonElement>
      ) => (
        <button aria-label={props['aria-label']} disabled={props.disabled}>
          {props.children}
        </button>
      ),
      Content: Pass,
      Group: Pass,
      Item: (
        props: import('solid-js').JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
          onSelect: () => void;
        }
      ) => (
        <button
          role={props.role}
          aria-checked={props['aria-checked']}
          onClick={props.onSelect}
        >
          {props.children}
        </button>
      ),
    }),
  };
});

describe('SessionStartToggle', () => {
  it('starts the selected mode from the send button and changes mode from the dropdown', () => {
    const onModeChange = vi.fn();
    const onStart = vi.fn();
    render(() => (
      <SessionStartToggle
        mode="live"
        committed="live"
        onModeChange={onModeChange}
        onStart={onStart}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onModeChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Background/ }));
    expect(onModeChange).toHaveBeenCalledWith('background');
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('starts in background when that mode is already selected', () => {
    const onModeChange = vi.fn();
    const onStart = vi.fn();
    render(() => (
      <SessionStartToggle
        mode="background"
        committed="background"
        onModeChange={onModeChange}
        onStart={onStart}
      />
    ));

    fireEvent.click(
      screen.getByRole('button', { name: 'Start session in background' })
    );
    expect(onStart).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Live/ }));
    expect(onModeChange).toHaveBeenCalledWith('live');
  });

  it('keeps the mode dropdown to the left of the send button', () => {
    render(() => (
      <SessionStartToggle
        mode="live"
        committed="live"
        onModeChange={vi.fn()}
        onStart={vi.fn()}
      />
    ));
    const group = screen.getByRole('group', { name: 'Session start mode' });
    const mode = screen.getByRole('button', { name: 'Session start mode' });
    const send = screen.getByRole('button', { name: 'Start session' });
    expect(group.contains(mode)).toBe(true);
    expect(group.contains(send)).toBe(true);
    expect(
      mode.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('previews background on the trigger without changing the committed check', () => {
    render(() => (
      <SessionStartToggle
        mode="background"
        committed="live"
        onModeChange={vi.fn()}
        onStart={vi.fn()}
      />
    ));
    expect(
      screen
        .getByRole('group', { name: 'Session start mode' })
        .getAttribute('data-session-start-mode')
    ).toBe('background');
    expect(
      screen.getByRole('button', { name: 'Start session in background' })
    ).toBeTruthy();
    expect(
      screen
        .getByRole('menuitemradio', { name: /Live/ })
        .getAttribute('aria-checked')
    ).toBe('true');
    expect(
      screen
        .getByRole('menuitemradio', { name: /Background/ })
        .getAttribute('aria-checked')
    ).toBe('false');
  });
});
