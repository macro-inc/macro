import {
  parseGithubPrUrl,
  toGithubKey,
} from '@app/features/block-pr/util/prKey';
import { fireAndForget } from '@core/util/fireAndForget';
import { isTauri } from '@core/util/platform';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import {
  fetchPullRequestByGithubKey,
  getCachedPullRequestByGithubKey,
} from '@queries/storage/pr-mention';
import { dispatchApplicationCommand } from '../group-b/command';
import type { MentionLinkResolver } from './textPastePlugin';

/** Host/cache facts and lookup transport only; native paste policy chooses the action. */
export function registerNativeTextPaste(
  view: EditorView,
  resolveAppLink?: MentionLinkResolver
): () => void {
  let active = true;
  const releaseFacts = view.clipboard.registerFacts((clipboard) => {
    const text = clipboard.getData('text/plain');
    const ref = parseGithubPrUrl(text);
    const githubKey = ref ? toGithubKey(ref) : undefined;
    const cached = githubKey
      ? getCachedPullRequestByGithubKey(githubKey)
      : undefined;
    return {
      entries: [
        {
          mime: 'application/x-macro-text-paste',
          value: JSON.stringify({
            hostname: view.root.ownerDocument.location.hostname,
            nativeHost: isTauri(),
            cachedPr: cached ? { githubKey, id: cached.id } : null,
            resolvedAppLink: resolveAppLink?.(text),
          }),
        },
      ],
      release() {},
    };
  });
  const releaseEvent = view.onPluginEvent('group-b.resolve-pr', (request) => {
    if (
      !request ||
      typeof request !== 'object' ||
      !('key' in request) ||
      typeof request.key !== 'number' ||
      !('generation' in request) ||
      typeof request.generation !== 'number' ||
      !('url' in request) ||
      typeof request.url !== 'string' ||
      !('githubKey' in request) ||
      typeof request.githubKey !== 'string'
    )
      return;
    const githubKey = request.githubKey;
    const generation = request.generation;
    fireAndForget(
      Telemetry.span('editor.paste.resolve-pr', async (span) => {
        const entity = await fetchPullRequestByGithubKey(githubKey);
        if (
          !entity ||
          !active ||
          !view.isMounted ||
          view.root.contentEditable !== 'true' ||
          view.mirror.keyGeneration !== generation
        )
          return;
        span.run(() =>
          dispatchApplicationCommand(view, 'group-b.resolve-pr', {
            request,
            id: entity.id,
          })
        );
      }),
      'editor.paste.resolve-pr'
    );
  });
  return () => {
    active = false;
    releaseEvent();
    releaseFacts();
  };
}
