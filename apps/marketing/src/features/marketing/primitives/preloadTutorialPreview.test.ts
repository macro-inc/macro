import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceFeatures } from '../core/workspace-features';
import {
  PAGE_TUTORIALS,
  preloadTutorialPreview,
} from './preloadTutorialPreview';

afterEach(() => vi.unstubAllGlobals());

describe('preloadTutorialPreview', () => {
  it('fetches a page’s preview once, and nothing for other pages', () => {
    const sources: string[] = [];
    vi.stubGlobal(
      'Image',
      class {
        set src(value: string) {
          sources.push(value);
        }
      }
    );

    preloadTutorialPreview('/pricing');
    preloadTutorialPreview('/booking-links');
    preloadTutorialPreview('/booking-links');

    expect(sources).toEqual(['/video/tutorials/scheduling-preview.jpg']);
  });

  it('covers every workspace feature page that has a tutorial', () => {
    for (const [slug, feature] of Object.entries(workspaceFeatures)) {
      expect(PAGE_TUTORIALS[`/${slug}`]).toBe(feature.tutorial);
    }
  });
});
