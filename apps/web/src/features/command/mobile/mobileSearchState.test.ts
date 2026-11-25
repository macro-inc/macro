import { afterEach, describe, expect, it } from 'vitest';
import {
  createMobileSearchSession,
  createMobileSearchState,
} from './mobileSearchState';

const state = createMobileSearchState();
afterEach(() => state.close());
describe('mobile search session', () => {
  it('shares composer promotion across the session until the input is cleared', () => {
    state.open();
    const session = state.session();
    state.setQuery('short search');
    expect(session.universalInputActive()).toBe(false);
    state.setQuery('create a task for the big launch plan');
    expect(session.universalInputActive()).toBe(true);
    state.setQuery('short');
    expect(session.universalInputActive()).toBe(true);
    const restored = createMobileSearchSession(session.snapshot());
    expect(restored.universalInputActive()).toBe(true);
    restored.setQuery('');
    expect(restored.universalInputActive()).toBe(false);
    state.setQuery('');
    expect(session.universalInputActive()).toBe(false);
  });
  it('keeps full text while editing, then resets on whitespace', () => {
    state.open();
    state.setQuery('teo');
    state.searchFullText();
    state.setQuery('teo update');
    expect(state.mode()).toBe('full-text');
    expect(state.query()).toBe('teo update');
    state.setQuery(' \t ');
    expect(state.mode()).toBe('name');
    state.setQuery('t');
    expect(state.mode()).toBe('name');
  });
  it('ignores repeated open and starts a new session in name mode after close', () => {
    state.open();
    state.setQuery('teo');
    state.searchFullText();
    state.open();
    expect(state.mode()).toBe('full-text');
    state.close();
    state.open();
    expect(state.query()).toBe('');
    expect(state.mode()).toBe('name');
    state.searchFullText();
    expect(state.mode()).toBe('name');
  });
  it("keeps an opener's bindings until their token is edited, and starts it as a search", () => {
    const binding = {
      token: 'tag:"🎉"',
      tags: [{ propertyId: 'prop-1', optionId: 'opt-1' }],
    };
    const opened = createMobileSearchSession({
      query: 'tag:"🎉" the quarterly planning review notes for launch',
      mode: 'name',
      bindings: [binding],
      universalInputActive: false,
    });
    // Words past the composer length stay a search the opener asked for.
    expect(opened.universalInputActive()).toBe(false);
    expect(opened.bindings()).toEqual([binding]);
    opened.setQuery('tag:"🎉" launch');
    expect(opened.bindings()).toEqual([binding]);
    expect(createMobileSearchSession(opened.snapshot()).bindings()).toEqual([
      binding,
    ]);
    opened.setQuery('tag:"🎉x" launch');
    expect(opened.bindings()).toEqual([]);
  });
});
