import { expect, it } from 'vitest';
import {
  EMPTY_STARTERS,
  FEATURED_DISCOVER,
  isPipedreamBrowseHidden,
  PIPEDREAM_BROWSE_HIDDEN_SLUGS,
} from './provider-meta';

it('keeps Notion on Discover Featured', () => {
  expect(FEATURED_DISCOVER).toContainEqual(
    expect.objectContaining({ id: 'notion' })
  );
  expect(FEATURED_DISCOVER).toBe(EMPTY_STARTERS);
});

it('hides first-party and Featured-owned slugs from Pipedream Browse', () => {
  for (const slug of [
    'gmail',
    'google_calendar',
    'google',
    'github',
    'linear',
    'notion',
    'slack',
    'cursor',
  ]) {
    expect(isPipedreamBrowseHidden(slug)).toBe(true);
  }
  expect(isPipedreamBrowseHidden('google_drive')).toBe(false);
  expect(isPipedreamBrowseHidden('google_sheets')).toBe(false);
  expect(PIPEDREAM_BROWSE_HIDDEN_SLUGS.has('gmail')).toBe(true);
});
