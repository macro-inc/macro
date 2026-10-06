import { thrownResultErrorHasCode } from '@core/util/result';
import { batch, createEffect, createMemo, createSignal, on } from 'solid-js';
import type { ReviewHost } from '../context/review-context';
import { hiddenFiles, reviewFileGroups } from '../core/file-groups';
import type { CodeLocation, ReviewThread } from '../core/model';
import type { NewComment } from '../core/source';

/** Reader state is pinned while metadata and discussion continue to refresh. */
export function createReview(host: ReviewHost) {
  const [location, setLocation] = createSignal<{
    at: CodeLocation;
    route: string;
  }>();
  const routeKey = (revision?: number, target?: string, thread?: string) =>
    `${host.navigation()}:${revision}:${target}:${thread}`;
  const route = () => routeKey(host.revision(), host.target(), host.thread());
  const [sequence, setSequence] = createSignal(0);
  const [preservedRoute, setPreservedRoute] = createSignal<{
    from: string;
    to: string;
  }>();
  const matchesRoute = (key: string | undefined) =>
    key === route() ||
    (key === preservedRoute()?.to && route() === preservedRoute()?.from);
  const scrollSequence = createMemo(
    (previous: { route: string; value: number } | undefined) => ({
      route: route(),
      value:
        route() === previous?.route || route() === preservedRoute()?.to
          ? (previous?.value ?? 0)
          : (previous?.value ?? 0) + 1,
    })
  );
  const [draft, setDraft] = createSignal('');
  const [composing, setComposing] = createSignal<CodeLocation>();
  const [replyTo, setReplyTo] = createSignal<string>();
  const [composeRevision, setComposeRevision] = createSignal<number>();
  const [pending, setPending] = createSignal<NewComment>();
  const [notice, setNotice] = createSignal('');
  const [chapter, setChapter] = createSignal(0);
  const revision = host.revision;
  const source = host.createSource(revision, host.open);
  const review = source.manifest.value;
  const latest = () => review()?.revisions.at(-1)?.number;
  const currentRevision = () => revision() ?? latest();
  const [following, setFollowing] = createSignal<boolean>();
  // Route changes express navigation intent; a metadata refresh does not.
  createEffect(
    on([host.navigation, host.revision, host.target, host.thread], () => {
      setFollowing(
        latest() === undefined
          ? undefined
          : !host.target() &&
              !host.thread() &&
              (!revision() || revision() === latest())
      );
    })
  );
  createEffect(() => {
    const number = latest();
    if (!number || !host.open()) return;
    if (following() === undefined) {
      setFollowing(
        !host.target() &&
          !host.thread() &&
          (!revision() || revision() === number)
      );
    }
    if (!revision()) host.selectRevision(number);
    else if (
      following() &&
      number > revision()! &&
      !composing() &&
      !draft().trim() &&
      !pending() &&
      !source.commenting()
    )
      chooseRevision(number);
  });
  const manifest = () =>
    review()?.revisions.find((r) => r.number === source.loadedRevision());
  const groups = createMemo(() =>
    reviewFileGroups(manifest()?.files ?? [], review()?.fileGroups ?? [])
  );
  const [visibility, setVisibility] = createSignal<
    ReadonlyMap<string, boolean>
  >(new Map());
  const hidden = createMemo(() => hiddenFiles(groups(), visibility()));
  const fileGroups = createMemo(() =>
    groups().map((group) => ({
      ...group,
      hidden: visibility().get(group.key) ?? group.hidden,
    }))
  );
  const visibleFiles = createMemo(
    () => manifest()?.files.filter((file) => !hidden().has(file.path)) ?? []
  );
  const toggleGroup = (key: string) => {
    const group = fileGroups().find((group) => group.key === key);
    if (group)
      setVisibility((previous) => new Map(previous).set(key, !group.hidden));
  };
  const initialTarget = createMemo(
    on(
      () => manifest()?.number,
      (): CodeLocation | undefined => {
        const focus = review()?.tour.find(
          (chapter) => !hidden().has(chapter.focus.path)
        )?.focus;
        if (focus) return focus;
        const file = visibleFiles()[0] ?? manifest()?.files[0];
        return file
          ? {
              path: file.path,
              side: file.status === 'deleted' ? 'old' : 'new',
              line: 1,
            }
          : undefined;
      }
    )
  );
  const targetAnchor = () =>
    review()?.anchors.find((a) => a.id === host.target());
  const target = (): CodeLocation | undefined =>
    (matchesRoute(location()?.route) ? location()?.at : undefined) ??
    (targetAnchor()?.revision === currentRevision()
      ? targetAnchor()?.original
      : currentRevision() === latest()
        ? targetAnchor()?.current
        : undefined) ??
    initialTarget();
  // Keep query options stable while the selection moves inside the same file.
  // Solid Query otherwise unwraps the entire cached source on every line click.
  const targetPath = createMemo(() => target()?.path);
  const needsFile = createMemo(() =>
    Boolean(manifest()?.files.some((entry) => entry.path === targetPath()))
  );
  const file = host.createFile(
    currentRevision,
    targetPath,
    () => host.open() && needsFile()
  );
  const loading = () =>
    source.manifest.phase() === 'loading' ||
    (source.loadedRevision() !== currentRevision() &&
      source.manifest.phase() !== 'error') ||
    (needsFile() && file.phase() === 'loading');
  const ready = () =>
    source.loadedRevision() === currentRevision() &&
    source.manifest.phase() === 'ready' &&
    needsFile() &&
    file.phase() === 'ready';
  const navigate = (next: CodeLocation) => {
    if (!revision() && latest()) host.selectRevision(latest()!);
    batch(() => {
      setLocation({ at: next, route: route() });
      setSequence((n) => n + 1);
    });
  };
  const chooseRevision = (number: number) => {
    const previous = target();
    const next = routeKey(number);
    batch(() => {
      setFollowing(number === latest());
      // The split router can publish its new search state after this call.
      // Preserve both sides of that transition without issuing a code jump.
      setPreservedRoute({ from: route(), to: next });
      if (previous) setLocation({ at: previous, route: next });
      host.selectRevision(number);
    });
    // Keep the current file if it survives; the view offers a clear missing-file state otherwise.
  };
  const chooseChapter = (index: number) => {
    const next = review()?.tour[index];
    if (next) {
      setChapter(index);
      const visible = next.paths.find((path) => !hidden().has(path));
      navigate(
        hidden().has(next.focus.path) && visible
          ? {
              path: visible,
              side:
                manifest()?.files.find((file) => file.path === visible)
                  ?.status === 'deleted'
                  ? 'old'
                  : 'new',
              line: 1,
            }
          : next.focus
      );
    }
  };
  const threads = createMemo((): ReviewThread[] => {
    const data = review();
    if (!data) return [];
    return data.threads.flatMap((thread) => {
      const anchor = data.anchors.find((a) => a.id === thread.anchor);
      if (!anchor) return [];
      const original = currentRevision() !== latest();
      if (original && anchor.revision > (currentRevision() ?? 0)) return [];
      return [
        {
          id: thread.id,
          location: original ? anchor.original : anchor.current,
          resolved: thread.resolved,
          outdated: original
            ? anchor.revision !== currentRevision()
            : anchor.status === 'outdated',
          originalRevision: anchor.revision,
          originalLocation: anchor.original,
          excerpt: anchor.excerpt,
          messages: thread.messages.map((message) => ({
            id: message.id,
            author:
              message.author.kind === 'agent'
                ? 'Agent'
                : message.author.id === host.userId()
                  ? 'You'
                  : host.displayName(message.author.id),
            body: message.body,
            delivery: message.delivery ?? undefined,
          })),
        },
      ];
    });
  });
  const select = (at: CodeLocation) => {
    if (!ready()) return;
    // Selecting visible code must not recenter the viewport under the pointer.
    setLocation({ at, route: route() });
  };
  const observeFile = (path: string) => {
    if (target()?.path === path) return;
    const entry = manifest()?.files.find((file) => file.path === path);
    if (entry)
      setLocation({
        at: { path, side: entry.status === 'deleted' ? 'old' : 'new', line: 1 },
        route: route(),
      });
  };
  const begin = (at: CodeLocation, thread?: string) => {
    if (!ready()) return;
    select(at);
    if (!host.canEdit() || source.commenting() || pending()) return;
    batch(() => {
      setComposeRevision(currentRevision());
      setComposing(at);
      setReplyTo(thread);
      setPending(undefined);
    });
  };
  const cancel = () => {
    if (source.commenting()) return;
    setComposing(undefined);
    setReplyTo(undefined);
    setPending(undefined);
  };
  const send = async () => {
    const at = composing();
    const number = composeRevision();
    if (
      !host.canEdit() ||
      !at ||
      !number ||
      !draft().trim() ||
      source.commenting() ||
      !ready()
    )
      return;
    const input = pending() ?? {
      id: crypto.randomUUID(),
      thread: replyTo() ?? null,
      revision: number,
      location: at,
      body: draft().trim(),
    };
    setPending(input);
    try {
      await source.comment(input);
      setPending(undefined);
      setDraft('');
      cancel();
      setNotice('Comment saved');
    } catch (error) {
      setNotice(
        `Comment could not be confirmed. Retry to check the same message. ${errorMessage(error)}`
      );
    }
  };
  const capture = async (silent = false) => {
    if (!host.canEdit() || source.capturing()) return;
    try {
      const result = await source.capture();
      if (!review()) chooseRevision(result.revision);
      if (!silent) setNotice(`Revision ${result.revision} is ready`);
    } catch (error) {
      // Another publisher can hold the capture lease during background polling.
      // Its session event refreshes this reader; the next poll can retry.
      if (silent && thrownResultErrorHasCode(error, 'CONFLICT')) return;
      setNotice(errorMessage(error));
    }
  };
  const resolve = async (id: string) => {
    if (!host.canEdit() || !ready()) return;
    const thread = threads().find((t) => t.id === id);
    if (!thread) return;
    try {
      await source.resolve({
        thread: id,
        resolved: !thread.resolved,
      });
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };
  return {
    source: { ...source, file },
    review,
    latest,
    currentRevision,
    manifest,
    fileGroups,
    toggleGroup,
    visibleFiles,
    loading,
    ready,
    target,
    // Metadata can notify the route memo without changing navigation intent.
    sequence: createMemo(() => `${sequence()}:${scrollSequence().value}`),
    composeRevision,
    pending,
    navigate,
    chapter,
    chooseChapter,
    chooseRevision,
    threads,
    composing,
    replyTo,
    draft,
    setDraft,
    begin,
    select,
    observeFile,
    cancel,
    send,
    capture,
    resolve,
    notice,
  };
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : 'Please try again';
}
