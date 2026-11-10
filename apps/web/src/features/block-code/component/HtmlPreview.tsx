import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableHtmlCodeMode } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import WarningCircle from '@icon/system/regular/warning-circle.svg';
import X from '@icon/system/regular/x.svg';
import { useQuery } from '@tanstack/solid-query';
import { Button } from '@ui/components/Button';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { attachEventHost } from '../code-mode/event-host';
import { composeProgramDocument } from '../code-mode/frame-helper';
import { attachNavigationGuard } from '../code-mode/navigation-guard';
import { attachProgramHost } from '../code-mode/preview-runner';
import { documentBuildQueryOptions } from '../queries/document-programs';

export type HtmlPreviewProps = {
  text: string;
  documentId?: string;
  /** A save of the editor's text is in flight; the build waits for it. */
  saving?: boolean;
  /** Completed saves so far, so each one builds the source it saved. */
  savedVersion?: number;
};

/**
 * Sandboxed render of an HTML file. With a stored document and the rollout
 * on, the preview shows the server's build of it: its programs run on the
 * server as the viewer through the frame's `window.macro`, and live entity
 * events (name and id only) reach the page; the frame never holds a
 * credential and never sends code. A page without program blocks renders as
 * plain HTML, exactly as with the rollout off.
 */
export function HtmlPreview(props: HtmlPreviewProps) {
  const codeMode = useFeatureFlag(enableHtmlCodeMode);
  const programs = () => (codeMode().enabled ? props.documentId : undefined);

  return (
    <div class="size-full bg-surface overflow-auto touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
      <Switch fallback={<PlainFrame html={props.text} />}>
        <Match when={programs()}>
          {(documentId) => (
            <BuiltPreview
              documentId={documentId()}
              fallbackHtml={props.text}
              saving={props.saving ?? false}
              savedVersion={props.savedVersion ?? 0}
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}

function PlainFrame(props: { html: string }) {
  return (
    <iframe
      title={t('htmlPreview.frameTitle')}
      class="size-full border-0"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcdoc={props.html}
    />
  );
}

/**
 * The server's build of the stored document, once the editor's last save
 * has landed. A page without programs, or one the server won't build for
 * this viewer (outside the rollout, too large, not HTML), renders as plain
 * HTML; a build the server failed is retried, then offers Retry.
 */
function BuiltPreview(props: {
  documentId: string;
  fallbackHtml: string;
  saving: boolean;
  savedVersion: number;
}) {
  const build = useQuery(() =>
    documentBuildQueryOptions(
      props.documentId,
      props.savedVersion,
      !props.saving
    )
  );
  const refused = (code: 'BUILD_UNAVAILABLE' | 'BUILD_TOO_LARGE') =>
    build.isError && thrownResultErrorHasCode(build.error, code);
  // A page over the build's size runs nothing; one with programs would
  // render broken, so it says why instead.
  const tooLarge = () =>
    refused('BUILD_TOO_LARGE') && hasProgramBlocks(props.fallbackHtml);
  const page = () => (build.isPending ? undefined : build.data);
  // Keyed by source: a refetch of the same source (on reconnect or focus)
  // keeps the frame, its state and its event stream.
  const built = createMemo(
    () => {
      const current = page();
      return current?.status === 'built' ? current : undefined;
    },
    undefined,
    { equals: (previous, next) => previous?.sourceHash === next?.sourceHash }
  );
  const failed = () => {
    const current = page();
    return current?.status === 'failed' ? current : undefined;
  };
  const plain = () => page()?.status === 'plain';
  // The build a run found stale; the frame that replaces it says why the
  // page reloaded, since the failure shown on the old one goes with it.
  const [staleBuild, setStaleBuild] = createSignal<string>();
  const refetch = () => {
    fireAndForget(build.refetch(), 'html-preview-build');
  };

  return (
    <Switch>
      <Match when={tooLarge()}>
        <PageTooLarge />
      </Match>
      <Match
        when={
          refused('BUILD_UNAVAILABLE') || refused('BUILD_TOO_LARGE') || plain()
        }
      >
        <PlainFrame html={props.fallbackHtml} />
      </Match>
      <Match when={failed()}>
        {(failure) => <BuildProblems problems={failure().diagnostics} />}
      </Match>
      <Match when={built()} keyed>
        {(current) => (
          <ProgramFrame
            documentId={props.documentId}
            html={current.html}
            sourceHash={current.sourceHash}
            notice={
              staleBuild() !== undefined && staleBuild() !== current.sourceHash
                ? t('htmlPreview.pageUpdated')
                : undefined
            }
            onStale={() => {
              setStaleBuild(current.sourceHash);
              refetch();
            }}
          />
        )}
      </Match>
      <Match when={build.isError}>
        <BuildError onRetry={refetch} />
      </Match>
    </Switch>
  );
}

/** Whether a page's source has program blocks or a client script to build. */
function hasProgramBlocks(html: string): boolean {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return (
    parsed.querySelector(
      'script[type="text/macro"], script[type="module"][lang="ts"]'
    ) !== null
  );
}

/**
 * One build's page, with its own token; a new build gets a new frame. The
 * latest failed run shows above it until dismissed, because a page that
 * doesn't catch its call's rejection otherwise shows nothing; `notice`
 * starts it, for a frame that replaced one whose run found it stale. A page
 * that starts to navigate away is closed, with a short notice in its place.
 */
export function ProgramFrame(props: {
  documentId: string;
  html: string;
  sourceHash: string;
  notice?: string;
  onStale: () => void;
}) {
  const token = crypto.randomUUID();
  const srcdoc = createMemo(() => composeProgramDocument(props.html, token));
  const [failure, setFailure] = createSignal<string | undefined>(
    untrack(() => props.notice)
  );
  const [left, setLeft] = createSignal(false);
  let frame: HTMLIFrameElement | undefined;

  createEffect(() => {
    if (!frame || left()) return;
    const { documentId, sourceHash, onStale } = props;
    onCleanup(
      attachNavigationGuard(frame, { token, onLeave: () => setLeft(true) })
    );
    onCleanup(
      attachProgramHost(frame, {
        documentId,
        sourceHash,
        token,
        onStale,
        onFailure: (message) => setFailure(message),
      })
    );
    onCleanup(attachEventHost(frame, { documentId, token }));
  });

  return (
    <Show when={!left()} fallback={<PageLeft />}>
      <div class="flex size-full flex-col">
        <Show when={failure()}>
          {(message) => (
            <RunFailure
              message={message()}
              onDismiss={() => setFailure(undefined)}
            />
          )}
        </Show>
        <iframe
          ref={frame}
          title={t('htmlPreview.frameTitle')}
          class="min-h-0 w-full flex-1 border-0"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcdoc={srcdoc()}
        />
      </div>
    </Show>
  );
}

/** The latest failed run's message, above the page. */
function RunFailure(props: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      class="flex shrink-0 items-center gap-2 border-edge-muted border-b bg-inset py-1 pr-1 pl-3 text-ink text-xs touch:min-h-11"
    >
      <WarningCircle class="size-3.5 shrink-0 text-failure" />
      <p class="max-h-[40dvh] min-w-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap wrap-anywhere">
        <span class="font-medium">{t('htmlPreview.programFailed')} </span>
        {props.message}
      </p>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('common.dismiss')}
        onClick={() => props.onDismiss()}
      >
        <X class="size-3.5 touch:size-5" />
      </Button>
    </div>
  );
}

/** In place of a page with programs that is over the build's size. */
function PageTooLarge() {
  return (
    <div role="alert" class="p-4 text-sm text-ink">
      <p class="font-medium">{t('htmlPreview.tooLargeTitle')}</p>
      <p class="mt-1 text-ink-muted">{t('htmlPreview.tooLargeDescription')}</p>
    </div>
  );
}

/** In place of a page that tried to navigate away. */
function PageLeft() {
  return (
    <div role="alert" class="p-4 text-sm text-ink">
      <p class="font-medium">{t('htmlPreview.pageLeftTitle')}</p>
      <p class="mt-1 text-ink-muted">{t('htmlPreview.pageLeftDescription')}</p>
    </div>
  );
}

/** The server failed to build the page, even after retrying. */
function BuildError(props: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      class="flex flex-col items-start gap-3 p-4 text-sm text-ink"
    >
      <div>
        <p class="font-medium">{t('htmlPreview.buildErrorTitle')}</p>
        <p class="mt-1 text-ink-muted">
          {t('htmlPreview.buildErrorDescription')}
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => props.onRetry()}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

/** Why the document doesn't build, block by block. */
function BuildProblems(props: {
  problems: { file?: string | null; message: string }[];
}) {
  return (
    <div class="p-4 text-sm text-ink">
      <p class="font-medium">{t('htmlPreview.buildFailedTitle')}</p>
      <ul class="mt-3 flex flex-col gap-3">
        <For each={props.problems}>
          {(problem) => (
            <li>
              {problem.file && (
                <p class="text-ink-muted text-xs">{problem.file}</p>
              )}
              <pre class="mt-1 whitespace-pre-wrap font-mono text-xs">
                {problem.message}
              </pre>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
