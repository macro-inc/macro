/**
 * @vitest-environment jsdom
 *
 * The Create-menu `c` then `a` path finds this composer by id and focuses the
 * contenteditable once the lazy agent block mounts (`triggerFocusInput` in
 * Launcher). That contract is the whole point of the id.
 */

import { triggerFocusInput } from '@core/directive/focusInput';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_INPUT_TEXT_AREA_ID } from './AgentInput';

describe('AGENT_INPUT_TEXT_AREA_ID', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('is the wrapper the launcher focuses into', () => {
    const wrap = document.createElement('div');
    wrap.id = AGENT_INPUT_TEXT_AREA_ID;
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.tabIndex = 0;
    wrap.appendChild(editor);
    document.body.appendChild(wrap);
    // jsdom reports 0×0 and a null offsetParent; the launcher path uses
    // `isVisible` before focusing, so pretend this is an on-screen editor.
    Object.defineProperty(editor, 'offsetParent', { get: () => document.body });

    triggerFocusInput(() =>
      document
        .getElementById(AGENT_INPUT_TEXT_AREA_ID)
        ?.querySelector<HTMLElement>('[contenteditable="true"]')
    );

    expect(document.activeElement).toBe(editor);
  });
});
