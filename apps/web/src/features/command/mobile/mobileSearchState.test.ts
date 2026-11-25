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
});
