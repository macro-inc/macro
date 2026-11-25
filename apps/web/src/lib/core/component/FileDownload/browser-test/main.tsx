import { downloadEmailAttachment } from '@app/features/email-message/attachment-action-adapter';
import { EmailAttachmentPill } from '@app/features/email-message/components/attachment-pill';
import { MediaPreview } from '@channel/Message/MediaPreview';
import { mediaDownloadSource } from '@channel/queries/static-media-download';
import { FileDownloadHeader } from '@components/app/FileDownloadHeader';
import { SidePanel } from '@components/app/side-panel/SidePanel';
import { DocumentDownloadButton } from '@core/component/DocumentDownloadButton';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createFileDownload } from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import { Match, Switch } from 'solid-js';
import { render } from 'solid-js/web';
import '../../../../../index.css';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

function HeaderFixture() {
  const download = createFileDownload(() =>
    mediaDownloadSource({
      id: 'download-video',
      kind: 'video',
      src: staticFileIdEndpoint('download-video'),
      fullSrc: staticFileIdEndpoint('download-video'),
    })
  );
  return (
    <SidePanel.Root floating>
      <header class="flex items-center justify-between gap-2 border-b border-edge pb-2">
        <span class="min-w-0 truncate">Team demo.webm</span>
        <SidePanel.HeaderActionsOutlet />
      </header>
      <FileDownloadHeader download={download} />
    </SidePanel.Root>
  );
}

const EMAIL_ATTACHMENT = {
  db_id: 'email-attachment',
  filename: 'Quarterly report.pdf',
  mime_type: 'application/pdf',
};

/** A received message's attachment chip, wired as the thread view wires it. */
function EmailAttachmentFixture() {
  return (
    <EmailAttachmentPill
      attachment={{
        fileName: EMAIL_ATTACHMENT.filename,
        mimeType: EMAIL_ATTACHMENT.mime_type,
      }}
      onDownload={() =>
        fireAndForget(
          downloadEmailAttachment(EMAIL_ATTACHMENT),
          'email-attachment'
        )
      }
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
const page = (name: string) => location.search.includes(name);
render(
  () => (
    <main class="min-h-screen bg-page p-4 text-ink">
      <Switch
        fallback={
          <MediaPreview
            items={[
              {
                id: 'download-video',
                kind: 'video',
                width: 480,
                height: 270,
                src: staticFileIdEndpoint('download-video'),
                fullSrc: staticFileIdEndpoint('download-video'),
              },
            ]}
          />
        }
      >
        <Match when={page('header')}>
          <HeaderFixture />
        </Match>
        <Match when={page('document')}>
          <div class="flex items-center gap-2">
            <span>birds folder</span>
            <DocumentDownloadButton documentId="linked-video" />
          </div>
        </Match>
        <Match when={page('email')}>
          <EmailAttachmentFixture />
        </Match>
      </Switch>
      <ToastRegion />
    </main>
  ),
  root
);
