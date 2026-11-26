import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Card } from './Card';

afterEach(cleanup);

describe('Card', () => {
  it.each(['ghost', 'outlined', 'filled', 'raised'] as const)(
    'puts props, events, and the layer on the %s root',
    (variant) => {
      const clicked = vi.fn();
      let root: HTMLDivElement | undefined;
      render(() => (
        <Card
          ref={(element) => (root = element)}
          variant={variant}
          depth={2}
          role="region"
          aria-label="Morning digest"
          onClick={clicked}
        >
          <Card variant="filled" offset={1}>
            <input aria-label="Note" />
          </Card>
        </Card>
      ));

      const card = screen.getByRole('region', { name: 'Morning digest' });
      expect(card).toBe(root);
      const input = screen.getByRole('textbox', { name: 'Note' });
      expect(card.contains(input)).toBe(true);
      expect(card.closest('[data-layer]')?.getAttribute('data-depth')).toBe(
        '2'
      );
      expect(input.closest('[data-layer]')?.getAttribute('data-depth')).toBe(
        '3'
      );

      fireEvent.click(input);

      expect(clicked).toHaveBeenCalledTimes(1);
    }
  );
});
