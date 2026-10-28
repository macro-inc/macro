import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailStarAction } from '../components/EmailRowActions';
import { createEmailRowActionState } from './row-action-state';

vi.mock('@ui', async () => ({
  Button: (await import('@app/components/ui/components/Button')).Button,
  cn: (await import('@app/components/ui/utils/classname')).cn,
}));

afterEach(cleanup);

describe('email row action state', () => {
  it('keeps other stars enabled while a row mutation is pending', async () => {
    const mutation = Promise.withResolvers<void>();
    let complete: Promise<void> | undefined;
    render(() => {
      const actions = createEmailRowActionState();
      return (
        <>
          <EmailStarAction
            starred={false}
            pending={actions.isPending('clicked-row')}
            onFocus={() => {}}
            onStar={() => {
              complete = actions.run('clicked-row', () => mutation.promise);
            }}
          />
          <EmailStarAction
            starred
            pending={actions.isPending('other-row')}
            onFocus={() => {}}
            onStar={() => {}}
          />
        </>
      );
    });

    const clicked = screen.getByRole('button', { name: 'Star email' });
    const other = screen.getByRole('button', { name: 'Unstar email' });
    fireEvent.click(clicked);

    expect(clicked.hasAttribute('data-disabled')).toBe(true);
    expect(other.hasAttribute('data-disabled')).toBe(false);
    expect(other.getAttribute('aria-pressed')).toBe('true');

    mutation.resolve();
    await complete;
    expect(clicked.hasAttribute('data-disabled')).toBe(false);
  });

  it('prevents overlapping writes and clears pending state after failure', async () => {
    const actions = createEmailRowActionState();
    const mutation = Promise.withResolvers<void>();
    const first = actions.run('first', () => mutation.promise);
    const duplicate = vi.fn(async () => {});
    await actions.run('first', duplicate);
    await actions.run('second', duplicate);
    expect(duplicate).not.toHaveBeenCalled();

    const failed = expect(first).rejects.toThrow('Update failed');
    mutation.reject(new Error('Update failed'));
    await failed;
    expect(actions.isPending('first')).toBe(false);
    await actions.run('second', duplicate);
    expect(duplicate).toHaveBeenCalledOnce();
  });
});
