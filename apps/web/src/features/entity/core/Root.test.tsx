import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import type { EntityData } from '../types/entity';
import { entityFromElement, Root } from './Root';

it('exposes the current row model without feature-specific DOM attributes', () => {
  const first: EntityData = {
    type: 'project',
    id: 'first',
    name: 'First',
    ownerId: 'viewer',
  };
  const next: EntityData = { ...first, id: 'next' };
  const [entity, setEntity] = createSignal(first);
  const view = render(() => <Root entity={entity()} />);
  const element = view.container.firstElementChild!;
  expect(entityFromElement(element)).toBe(first);
  setEntity(next);
  expect(entityFromElement(element)).toBe(next);
  expect(
    element.getAttributeNames().some((name) => name.startsWith('data-preload'))
  ).toBe(false);
  view.unmount();
});
