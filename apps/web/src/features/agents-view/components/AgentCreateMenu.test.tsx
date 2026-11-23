import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentCreateMenu } from './AgentsSidebar';

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '[role="menu"] { animation-name: none; transition-duration: 0s; }';
  document.head.append(motionStyles);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

it.each(['Conversation', 'Work agent', 'Coding agent', 'Routine'])(
  'keeps the focus %s moves instead of returning it to New',
  async (label) => {
    render(() => {
      let field!: HTMLTextAreaElement;
      return (
        <>
          <textarea ref={field} aria-label="Opened field" />
          <AgentCreateMenu
            onConversation={() => field.focus()}
            onCreate={() => field.focus()}
            onRoutine={() => field.focus()}
          />
        </>
      );
    });
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'New conversation or agent' }),
      { key: 'Enter' }
    );
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: label }), {
      key: 'Enter',
    });

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Opened field' })
      )
    );
  }
);
