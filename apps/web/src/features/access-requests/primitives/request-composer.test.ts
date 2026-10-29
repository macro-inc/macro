import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { fakeSharingSource } from '../tests/source';
import { createRequestComposer } from './request-composer';

const pending = {
  id: 'request',
  requesterId: 'macro|reader@test.com',
  requestedLevel: 'comment' as const,
  status: 'pending' as const,
  revision: 3,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('request composer', () => {
  it('offers initial access when the viewer has no permission', async () => {
    const [composer, source, dispose] = createRoot((dispose) => {
      const { source } = fakeSharingSource({ accessLevel: null, owner: null });
      return [
        createRequestComposer(source, () => ['view', 'comment', 'edit']),
        source,
        dispose,
      ] as const;
    });
    expect(composer.visible()).toBe(true);
    expect(composer.levels()).toEqual(['view', 'comment', 'edit']);
    await composer.send();
    expect(source.submit).toHaveBeenCalledWith('view', undefined);
    dispose();
  });

  it('offers only supported upgrades and hides for editors and reviewers', () =>
    createRoot((dispose) => {
      const { source, setState } = fakeSharingSource({
        accessLevel: 'comment',
      });
      const composer = createRequestComposer(source, () => ['comment', 'edit']);
      expect(composer.levels()).toEqual(['edit']);
      setState((s) => ({ ...s, accessLevel: 'edit' }));
      expect(composer.visible()).toBe(false);
      setState((s) => ({ ...s, canReview: true, accessLevel: 'owner' }));
      expect(composer.visible()).toBe(false);
      dispose();
    }));

  it('does not offer View to someone who can already view the file', () =>
    createRoot((dispose) => {
      const { source } = fakeSharingSource({ accessLevel: 'view' });
      const composer = createRequestComposer(source, () => [
        'view',
        'comment',
        'edit',
      ]);
      expect(composer.levels()).toEqual(['comment', 'edit']);
      dispose();
    }));

  it('honors surface capabilities', () =>
    createRoot((dispose) => {
      const { source } = fakeSharingSource();
      const composer = createRequestComposer(source, () => ['comment']);
      expect(composer.levels()).toEqual(['comment']);
      expect(composer.level()).toBe('comment');
      dispose();
    }));

  it('changes and cancels the current revision while preserving a failed request', async () => {
    const [composer, source, dispose] = createRoot((dispose) => {
      const { source } = fakeSharingSource({ mine: pending });
      return [
        createRequestComposer(source, () => ['comment', 'edit']),
        source,
        dispose,
      ] as const;
    });
    expect(composer.unchanged()).toBe(true);
    composer.setSelected('edit');
    await composer.send();
    expect(source.submit).toHaveBeenCalledWith('edit', 3);
    vi.mocked(source.cancel).mockRejectedValueOnce(new Error('offline'));
    await expect(composer.cancel()).rejects.toThrow('offline');
    expect(composer.pending()).toBe(true);
    expect(source.cancel).toHaveBeenCalledWith(3);
    dispose();
  });

  it('shows the denial cooldown for either requested level', () =>
    createRoot((dispose) => {
      const { source } = fakeSharingSource({
        mine: {
          ...pending,
          status: 'denied',
          retryAfter: new Date(Date.now() + 86_400_000).toISOString(),
        },
      });
      const composer = createRequestComposer(source, () => ['comment', 'edit']);
      expect(composer.coolingDown()).toBe(true);
      composer.setSelected('edit');
      expect(composer.coolingDown()).toBe(true);
      expect(composer.visible()).toBe(true);
      dispose();
    }));
});
