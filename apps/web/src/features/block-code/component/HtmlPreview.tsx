import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableHtmlCodeMode } from '@core/constant/featureFlags';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import {
  createEffect,
  createMemo,
  For,
  Match,
  onCleanup,
  Switch,
} from 'solid-js';
import { attachEventHost } from '../code-mode/event-host';
import { composeProgramDocument } from '../code-mode/frame-helper';
import { attachProgramHost } from '../code-mode/preview-runner';
import { documentBuildQueryOptions } from '../queries/document-programs';
import { documentProgramKeys } from '../queries/keys';

/**
 * Sandboxed render of an HTML file. With a stored document and the rollout
 * on, the preview shows the server's build of it: its programs run on the
 * server as the viewer through the frame's `window.macro`, and live entity
 * events (name and id only) reach the page; the frame never holds a
 * credential and never sends code.
 */
export function HtmlPreview(props: { text: string; documentId?: string }) {
  const codeMode = useFeatureFlag(enableHtmlCodeMode);
  const programs = () => (codeMode().enabled ? props.documentId : undefined);

  return (
    <div class="size-full bg-surface overflow-auto touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
      <Switch fallback={<PlainFrame html={props.text} />}>
        <Match when={programs()}>
          {(documentId) => (
            <BuiltPreview documentId={documentId()} fallbackHtml={props.text} />
          )}
        </Match>
      </Switch>
    </div>
  );
}

function PlainFrame(props: { html: string }) {
  return (
    <iframe
      title="HTML preview"
      class="size-full border-0"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcdoc={props.html}
    />
  );
}

/**
 * The server's build of the stored document. A document it can't build
 * (not HTML, too large, unreachable) renders as plain HTML.
 */
function BuiltPreview(props: { documentId: string; fallbackHtml: string }) {
  const queryClient = useQueryClient();
  const build = useQuery(() => documentBuildQueryOptions(props.documentId));
  const built = () =>
    build.isSuccess && build.data.status === 'built' ? build.data : undefined;
  const failed = () =>
    build.isSuccess && build.data.status === 'failed' ? build.data : undefined;
  const refetch = () =>
    queryClient.invalidateQueries({
      queryKey: documentProgramKeys.build(props.documentId).queryKey,
    });

  return (
    <Switch>
      <Match when={build.isPending}>{null}</Match>
      <Match when={build.isError}>
        <PlainFrame html={props.fallbackHtml} />
      </Match>
      <Match when={failed()}>
        {(failure) => <BuildProblems problems={failure().diagnostics} />}
      </Match>
      <Match when={built()} keyed>
        {(page) => (
          <ProgramFrame
            documentId={props.documentId}
            html={page.html}
            sourceHash={page.sourceHash}
            onStale={refetch}
          />
        )}
      </Match>
    </Switch>
  );
}

/** One build's page, with its own token; a new build gets a new frame. */
function ProgramFrame(props: {
  documentId: string;
  html: string;
  sourceHash: string;
  onStale: () => void;
}) {
  const token = crypto.randomUUID();
  const srcdoc = createMemo(() => composeProgramDocument(props.html, token));
  let frame: HTMLIFrameElement | undefined;

  createEffect(() => {
    if (!frame) return;
    const { documentId, sourceHash, onStale } = props;
    onCleanup(
      attachProgramHost(frame, { documentId, sourceHash, token, onStale })
    );
    onCleanup(attachEventHost(frame, { documentId, token }));
  });

  return (
    <iframe
      ref={frame}
      title="HTML preview"
      class="size-full border-0"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcdoc={srcdoc()}
    />
  );
}

/** Why the document doesn't build, block by block. */
function BuildProblems(props: {
  problems: { file?: string | null; message: string }[];
}) {
  return (
    <div class="p-4 text-sm text-ink">
      <p class="font-medium">This page doesn't build.</p>
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
