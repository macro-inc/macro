import type { JSX } from 'solid-js';

/** Minimal Dropdown stub for connections settings tests. */
export async function mockUiWithDropdown(
  importOriginal: () => Promise<typeof import('@ui')>
) {
  const actual = await importOriginal();
  const Dropdown = Object.assign(
    (p: { children?: JSX.Element }) => <>{p.children}</>,
    {
      Trigger: (p: { 'aria-label'?: string; children?: JSX.Element }) => (
        <button type="button" aria-label={p['aria-label']}>
          {p.children}
        </button>
      ),
      Content: (p: { children?: JSX.Element }) => <div>{p.children}</div>,
      Group: (p: { children?: JSX.Element }) => <div>{p.children}</div>,
      Item: (p: { children?: JSX.Element; onSelect?: () => void }) => (
        <div role="menuitem" onClick={() => p.onSelect?.()}>
          {p.children}
        </div>
      ),
    }
  );
  return { ...actual, Dropdown };
}
