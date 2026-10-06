import { createReviewFile, createReviewSource } from '../queries/review';
/** Production reader against a loopback review_lab server, routed by the browser test. */

import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { createSignal, onCleanup } from 'solid-js';
import { ReviewSessionSurface, ReviewToggle } from '../agent-review';
import { type ReviewHost, ReviewHostContext } from '../context/review-context';

export default function Integration() {
  const [params, setParams] = createSignal(
    new URLSearchParams(window.location.search)
  );
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params());
    for (const [key, value] of Object.entries(patch))
      next.set(`s0.review.${key}`, value);
    window.history.pushState({}, '', `${window.location.pathname}?${next}`);
    setParams(next);
  };
  const popped = () => setParams(new URLSearchParams(window.location.search));
  window.addEventListener('popstate', popped);
  onCleanup(() => window.removeEventListener('popstate', popped));
  const get = (key: string) => params().get(`s0.review.${key}`) || undefined;
  const [navigation, setNavigation] = createSignal(0);
  const host: ReviewHost = {
    createSource: (revision, active) =>
      createReviewSource(
        () => '00000000-0000-0000-0000-00000000000a',
        revision,
        active
      ),
    createFile: (revision, path, active) =>
      createReviewFile(
        () => '00000000-0000-0000-0000-00000000000a',
        revision,
        path,
        active
      ),
    navigation,
    sessionId: () => '00000000-0000-0000-0000-00000000000a',
    userId: () => 'macro|owner@example.com',
    displayName: (id) => id,
    available: () => true,
    canEdit: () => get('readonly') !== 'true',
    open: () => get('open') === 'true',
    reviewId: () => get('id'),
    revision: () => Number(get('revision')) || undefined,
    target: () => get('target'),
    thread: () => get('thread'),
    savedNotes: () => [],
    show: () => update({ open: 'true' }),
    back: () => update({ open: 'false' }),
    selectRevision: (revision) =>
      update({ revision: String(revision), target: '', thread: '' }),
    openLink: (href) => {
      const url = new URL(href, window.location.href);
      if (url.searchParams.get('s0.review.open') !== 'true') return false;
      setNavigation((n) => n + 1);
      update(
        Object.fromEntries(
          ['open', 'id', 'revision', 'target', 'thread'].map((key) => [
            key,
            url.searchParams.get(`s0.review.${key}`) ?? '',
          ])
        )
      );
      return true;
    },
  };
  return (
    <StaticMarkdownContext>
      <ReviewHostContext.Provider value={host}>
        <div class="flex h-full min-h-0 flex-col" data-review-integration>
          <ReviewSessionSurface>
            <div class="flex h-full flex-col gap-4 p-6">
              <p class="text-sm text-ink-muted">
                Local integration session · actual review service and MCP tools
              </p>
              <ReviewToggle />
              <label>
                Session draft
                <textarea
                  class="block w-full border border-edge bg-input p-3"
                  aria-label="Session message draft"
                />
              </label>
            </div>
          </ReviewSessionSurface>
        </div>
      </ReviewHostContext.Provider>
    </StaticMarkdownContext>
  );
}
