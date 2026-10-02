import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { Property } from '../types';
import { PropertyTooltip } from './PropertyTooltip';

vi.mock('@ui', () => ({
  HoverCard: (props: { content: JSX.Element; children: JSX.Element }) => (
    <div>
      {props.children}
      <div data-testid="hover-content">{props.content}</div>
    </div>
  ),
}));
vi.mock('@property/component/propertyValue/PropertyTooltip', () => ({
  PropertyTooltip: (props: { property: Property }) => (
    <span>{props.property.displayName}: original tooltip</span>
  ),
}));
afterEach(cleanup);

const property: Property = {
  propertyId: 'assignment',
  propertyDefinitionId: 'definition',
  displayName: 'Review notes',
  valueType: 'STRING',
  value: 'Notes',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

it('keeps the original tooltip when conditional management actions render nothing', () => {
  const [canManage, setCanManage] = createSignal(false);
  render(() => (
    <PropertyTooltip
      property={property}
      actions={
        <Show when={canManage()}>
          <button>Unpin</button>
          <button>Delete from item</button>
        </Show>
      }
    >
      <button>Property</button>
    </PropertyTooltip>
  ));
  expect(screen.getByText('Review notes: original tooltip')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Unpin' })).toBeNull();
  expect(
    screen.getByTestId('hover-content').querySelector('.border-t')
  ).toBeNull();

  setCanManage(true);
  expect(screen.getByText('Review notes: original tooltip')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Unpin' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Delete from item' })).toBeTruthy();

  setCanManage(false);
  expect(screen.getByText('Review notes: original tooltip')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Unpin' })).toBeNull();
});

it('shows the original tooltip with no actions supplied', () => {
  render(() => (
    <PropertyTooltip property={property}>
      <button>Property</button>
    </PropertyTooltip>
  ));
  expect(screen.getByText('Review notes: original tooltip')).toBeTruthy();
});
