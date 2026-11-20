import { describe, expect, it } from 'vitest';
import { normalizePins } from './single-sidebar-pins';

describe('normalizePins', () => {
  it('keeps known destinations once, in saved order', () => {
    expect(normalizePins(['tasks', 'mail', 'tasks', 'agents'])).toEqual([
      'tasks',
      'mail',
      'agents',
    ]);
  });

  it('drops destinations the app no longer has', () => {
    expect(normalizePins(['mail', 'retired-view'])).toEqual(['mail']);
  });
});
