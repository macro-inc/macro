/**
 * @vitest-environment jsdom
 *
 * Only web pages are unfurled; a relative link, such as an agent's link to
 * code, is never sent to the unfurl service.
 */

import { render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const unfurled = vi.fn((_url: string | undefined) => [
  () => undefined,
  { refetch: () => {} },
]);
vi.mock('@core/signal/unfurl', () => ({
  useUnfurl: (url: string | undefined) => unfurled(url),
}));

import { LinkWithPreview } from './LinkWithPreview';

afterEach(() => unfurled.mockClear());

describe('LinkWithPreview', () => {
  it('unfurls an http(s) page', () => {
    render(() => (
      <LinkWithPreview url="https://example.com/a">a page</LinkWithPreview>
    ));
    expect(unfurled).toHaveBeenCalledWith('https://example.com/a');
  });

  it('does not unfurl a relative link to code', () => {
    render(() => (
      <LinkWithPreview url="apps/web/src/a.ts#L2">a.ts:2</LinkWithPreview>
    ));
    expect(unfurled).toHaveBeenCalledWith(undefined);
  });
});
