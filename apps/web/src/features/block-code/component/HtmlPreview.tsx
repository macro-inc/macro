import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableHtmlCodeMode } from '@core/constant/featureFlags';
import { createEffect, createMemo, onCleanup } from 'solid-js';
import { composeProgramDocument } from '../code-mode/frame-helper';
import { attachProgramHost } from '../code-mode/preview-runner';

/**
 * Sandboxed render of an HTML file. With a document id and the rollout on,
 * the frame gets `window.macro`, whose `run` executes the file's `text/macro`
 * blocks on the server as the viewer; the frame itself stays credential-free.
 */
export function HtmlPreview(props: { text: string; documentId?: string }) {
  const codeMode = useFeatureFlag(enableHtmlCodeMode);
  const token = crypto.randomUUID();
  const programs = () => (codeMode().enabled ? props.documentId : undefined);
  const srcdoc = createMemo(() =>
    programs() ? composeProgramDocument(props.text, token) : props.text
  );
  let frame: HTMLIFrameElement | undefined;

  createEffect(() => {
    const documentId = programs();
    if (!documentId || !frame) return;
    onCleanup(attachProgramHost(frame, { documentId, token }));
  });

  return (
    <div class="size-full bg-surface overflow-auto touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
      <iframe
        ref={frame}
        title="HTML preview"
        class="size-full border-0"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcdoc={srcdoc()}
      />
    </div>
  );
}
