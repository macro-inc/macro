// @vitest-environment jsdom
import { beforeAll, expect, test, vi } from 'vitest';
import { CLICK_COMMAND, createViewCommand } from './commands';
import { readSelection } from './selection';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
  transfer,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

function selectedBody() {
  const fixture = nativeSurface();
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [
              {
                type: 'text',
                version: 1,
                text: 'kept',
                format: 0,
                mode: 'normal',
                style: '',
                detail: 0,
              },
            ],
          },
        ],
      },
    })
  );
  const text = document
    .createTreeWalker(fixture.root, NodeFilter.SHOW_TEXT)
    .nextNode();
  if (!text) throw new Error('Missing actual text DOM');
  fixture.root.focus();
  document.getSelection()?.setBaseAndExtent(text, 0, text, 4);
  fixture.port.selectionFromView(readSelection(fixture.view));
  return fixture;
}

test.each([
  'paste',
  'cut',
  'beforeinput',
  'input',
  'compositionstart',
  'compositionend',
  'keydown',
])('readonly root rejects %s before any model admission', async (name) => {
  const fixture = selectedBody();
  try {
    fixture.view.setEditable(false);
    const before = fixture.session.serializedState();
    const input = vi.spyOn(fixture.port, 'input');
    const command = vi.spyOn(fixture.port, 'command');
    const composition = vi.spyOn(fixture.port, 'composition');
    const keyDown = vi.spyOn(fixture.port, 'keyDown');
    const text = vi.spyOn(fixture.port, 'textFromView');
    let event: Event;
    if (name === 'keydown')
      event = new KeyboardEvent(name, {
        key: 'Backspace',
        bubbles: true,
        cancelable: true,
      });
    else if (name === 'beforeinput' || name === 'input')
      event = new InputEvent(name, {
        inputType: 'insertFromPaste',
        data: 'NEW',
        bubbles: true,
        cancelable: true,
      });
    else if (name === 'compositionstart' || name === 'compositionend')
      event = new CompositionEvent(name, {
        data: 'NEW',
        bubbles: true,
        cancelable: true,
      });
    else event = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: transfer('NEW') });
    fixture.root.dispatchEvent(event);
    await Promise.resolve();
    expect(fixture.session.serializedState()).toBe(before);
    expect(input).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    expect(composition).not.toHaveBeenCalled();
    expect(keyDown).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  } finally {
    vi.restoreAllMocks();
    fixture.close();
  }
});

test('readonly copy remains available and paste resumes after unlocking', async () => {
  const fixture = selectedBody();
  try {
    fixture.view.setEditable(false);
    const clipboard = transfer('');
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copy, 'clipboardData', { value: clipboard });
    fixture.root.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    expect(clipboard.getData('text/plain')).toBe('kept');
    expect(await fixture.view.clipboard.paste(transfer('NEW'))).toBe(false);
    expect(fixture.root.textContent).toBe('kept');
    fixture.view.setEditable(true);
    expect(await fixture.view.clipboard.paste(transfer('NEW'))).toBe(true);
    expect(fixture.root.textContent).toBe('NEW');
  } finally {
    fixture.close();
  }
});

test('lazy HTML paste cancels after editability changes and releases facts once', async () => {
  const fixture = selectedBody();
  let releases = 0;
  const stop = fixture.view.clipboard.registerFacts(() => ({
    entries: [],
    release() {
      releases++;
    },
  }));
  try {
    const before = fixture.session.serializedState();
    const pending = fixture.view.clipboard.paste(transfer('NEW', '<p>NEW</p>'));
    fixture.view.setEditable(false);
    expect(await pending).toBe(false);
    expect(fixture.session.serializedState()).toBe(before);
    expect(releases).toBe(1);
    fixture.view.setEditable(true);
    expect(await fixture.view.clipboard.paste(transfer('NEW'))).toBe(true);
    expect(releases).toBe(2);
  } finally {
    stop();
    fixture.close();
  }
});

test('readonly drop skips registered drop handlers while click stays available', () => {
  const fixture = selectedBody();
  let drops = 0;
  let clicks = 0;
  const stopDrop = fixture.view.registerViewCommand(
    createViewCommand(
      'Drop',
      (payload): payload is Event => payload instanceof Event
    ),
    () => {
      drops++;
      return true;
    },
    4
  );
  const stopClick = fixture.view.registerViewCommand(
    CLICK_COMMAND,
    () => {
      clicks++;
      return true;
    },
    4
  );
  try {
    fixture.view.setEditable(false);
    const before = fixture.session.serializedState();
    fixture.root.dispatchEvent(
      new Event('drop', { bubbles: true, cancelable: true })
    );
    fixture.root.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(drops).toBe(0);
    expect(clicks).toBe(1);
    expect(fixture.session.serializedState()).toBe(before);
  } finally {
    stopDrop();
    stopClick();
    fixture.close();
  }
});
