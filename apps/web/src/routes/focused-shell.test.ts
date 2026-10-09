import { describe, expect, it } from 'vitest';
import { usesFocusedShell } from './focused-shell';

describe('usesFocusedShell', () => {
  it('keeps booking links focused for everyone', () => {
    expect(usesFocusedShell('/app/book/ada/intro', true)).toBe(true);
    expect(usesFocusedShell('/app/booking/receipt-1', false)).toBe(true);
  });

  it('renders a form’s respond link focused for anonymous visitors, inside the app shell once signed in', () => {
    expect(usesFocusedShell('/app/form/form-1/respond', false)).toBe(true);
    expect(usesFocusedShell('/app/form/form-1/respond', true)).toBe(false);
  });

  it('leaves app routes, the form block included, in the app shell', () => {
    expect(usesFocusedShell('/app/form/form-1', false)).toBe(false);
    expect(usesFocusedShell('/app/home', true)).toBe(false);
  });
});
