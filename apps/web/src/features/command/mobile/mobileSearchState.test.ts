import { afterEach, describe, expect, it } from 'vitest';
import { createMobileSearchState } from './mobileSearchState';

const state = createMobileSearchState();
afterEach(() => state.close());
describe('mobile search session', () => {
  it('keeps full text while editing and switching categories, then resets on whitespace', () => {
    state.open();
    state.setCategory('email');
    state.setQuery('teo');
    state.searchFullText();
    state.setQuery('teo update');
    state.setCategory('tasks');
    expect(state.mode()).toBe('full-text');
    expect(state.query()).toBe('teo update');
    state.setQuery(' \t ');
    expect(state.mode()).toBe('name');
    expect(state.category()).toBe('tasks');
    state.setQuery('t');
    expect(state.mode()).toBe('name');
  });
  it('keeps Projects name-only and retains the query when selected', () => {
    state.open();
    state.setQuery('teo');
    state.searchFullText();
    state.setCategory('projects');
    expect(state.mode()).toBe('name');
    expect(state.query()).toBe('teo');
    state.searchFullText();
    expect(state.mode()).toBe('name');
  });
  it('ignores repeated open and starts a new session in All/name after close', () => {
    state.open();
    state.setCategory('email');
    state.setQuery('teo');
    state.searchFullText();
    state.open();
    expect(state.mode()).toBe('full-text');
    expect(state.category()).toBe('email');
    state.close();
    state.open();
    expect(state.query()).toBe('');
    expect(state.category()).toBe('all');
    expect(state.mode()).toBe('name');
    state.searchFullText();
    expect(state.mode()).toBe('name');
  });
});
