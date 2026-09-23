import { describe, expect, it } from 'vitest';
import { displayPath, displayPaths } from './display-path';

describe('displayPath', () => {
  it.each([undefined, '', '/'])(
    'leaves paths unchanged without a usable workspace (%s)',
    (workspace) => {
      expect(displayPath('/workspace/apps/web/foo.ts', workspace)).toBe(
        '/workspace/apps/web/foo.ts'
      );
    }
  );

  it('drops a workspace directory prefix', () => {
    expect(displayPath('/workspace/apps/web/foo.ts', '/workspace')).toBe(
      'apps/web/foo.ts'
    );
  });

  it('treats a trailing slash on the workspace as the same root', () => {
    expect(displayPath('/workspace/apps/web/foo.ts', '/workspace/')).toBe(
      'apps/web/foo.ts'
    );
  });

  it('renders the workspace itself as the current directory', () => {
    expect(displayPath('/workspace', '/workspace')).toBe('.');
    expect(displayPath('/workspace/', '/workspace')).toBe('.');
  });

  it('does not strip a longer path that only shares a prefix string', () => {
    expect(displayPath('/workspace-extra/foo.ts', '/workspace')).toBe(
      '/workspace-extra/foo.ts'
    );
  });

  it('leaves already-relative paths and other roots alone', () => {
    expect(displayPath('apps/web/foo.ts', '/workspace')).toBe(
      'apps/web/foo.ts'
    );
    expect(displayPath('/tmp/out.rs', '/workspace')).toBe('/tmp/out.rs');
  });
});

describe('displayPaths', () => {
  it('maps every path through the same workspace prefix', () => {
    expect(
      displayPaths(['/workspace/a.rs', '/tmp/b.rs', '/workspace'], '/workspace')
    ).toEqual(['a.rs', '/tmp/b.rs', '.']);
  });
});
