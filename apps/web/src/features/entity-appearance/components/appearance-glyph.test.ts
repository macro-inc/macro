import { render, waitFor } from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { EntityAppearance } from '../core/appearance';
import { AppearanceGlyph } from './appearance-glyph';

vi.mock('../core/catalog.generated', () => ({
  ENTITY_ICON_ALIASES: { 'former-idea': 'lightbulb' },
}));

it('renders permanent aliases through the entity artwork and falls back for unknown names', async () => {
  const fallback = document.createElement('span');
  fallback.textContent = 'Default';
  const [appearance, setAppearance] = createSignal<EntityAppearance>({
    icon: { kind: 'macro', name: 'former-idea' },
    color: null,
  });
  const { container } = render(() =>
    createComponent(AppearanceGlyph, {
      get appearance() {
        return appearance();
      },
      children: fallback,
    })
  );
  await waitFor(() =>
    expect(
      container.querySelector('svg')?.getAttribute('data-macro-icon')
    ).toBe('lightbulb')
  );
  setAppearance({ icon: { kind: 'macro', name: 'unknown-icon' }, color: null });
  expect(container.querySelector('svg')).toBeNull();
  expect(container.firstElementChild).toBe(fallback);
});
