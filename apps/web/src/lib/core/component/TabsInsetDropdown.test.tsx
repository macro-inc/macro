/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { TabsInsetDropdown } from './TabsInsetDropdown';

vi.mock('@ui', () => {
  const cn = (...args: unknown[]) =>
    args.flat(Infinity).filter(Boolean).join(' ');
  const Dropdown: any = (p: any) => <div>{p.children}</div>;
  Dropdown.Trigger = (p: any) => (
    <button type="button" data-trigger class={p.class}>
      {p.children}
    </button>
  );
  Dropdown.Content = (p: any) => <div>{p.children}</div>;
  Dropdown.Group = (p: any) => <div data-group>{p.children}</div>;
  Dropdown.GroupLabel = (p: any) => <div data-group-label>{p.children}</div>;
  Dropdown.Item = (p: any) => (
    <div role="menuitem" class={p.class} onClick={() => p.onSelect?.()}>
      {p.children}
    </div>
  );
  const Layer = (p: any) => <>{p.children}</>;
  return { cn, Dropdown, Layer };
});

vi.mock('@phosphor/caret-down.svg', () => ({ default: () => null }));
vi.mock('@phosphor/check.svg', () => ({ default: () => null }));

describe('TabsInsetDropdown', () => {
  it('renders labeled groups and keeps a flat list unlabeled', () => {
    const groups = render(() => (
      <TabsInsetDropdown
        value="account"
        groups={[
          {
            label: 'General',
            items: [{ value: 'account', label: 'Account' }],
          },
          {
            label: 'Workspace',
            items: [{ value: 'team', label: 'Team' }],
          },
        ]}
      />
    ));
    const labels = Array.from(
      groups.container.querySelectorAll('[data-group-label]')
    ).map((el) => el.textContent);
    expect(labels).toEqual(['General', 'Workspace']);
    expect(groups.container.querySelectorAll('[role="menuitem"]')).toHaveLength(
      2
    );

    const list = render(() => (
      <TabsInsetDropdown
        value="a"
        list={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />
    ));
    expect(list.container.querySelectorAll('[data-group-label]')).toHaveLength(
      0
    );
    expect(list.container.querySelectorAll('[role="menuitem"]')).toHaveLength(
      2
    );
    expect(list.container.textContent).toContain('Alpha');
    expect(list.container.textContent).toContain('Beta');
  });
});
