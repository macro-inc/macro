import '@fontsource-variable/inter';
import '../../../index.css';
import PaperclipIcon from '@phosphor/paperclip.svg';
import TextAa from '@phosphor/text-aa.svg';
import TrashIcon from '@phosphor/trash.svg';
import { Button, SendButton } from '@ui';
import { render } from 'solid-js/web';
import { EmailDateSelector } from '../components/email-date-selector';

const LONG_SCHEDULE_LABEL =
  'Wednesday, September 30, 2026 at 11:59 PM Coordinated Universal Time';

function Fixture() {
  const params = new URLSearchParams(location.search);
  const mobile = params.has('mobile');
  const width = Number(params.get('width') ?? (mobile ? 240 : 420));
  document.documentElement.dataset.touchDevice = String(mobile);

  return (
    <main class="min-h-screen bg-surface p-4 text-ink">
      <div
        data-testid="toolbar"
        class="flex items-center justify-end gap-1 rounded-xl border border-edge-muted p-2"
        style={{ width: `${width}px` }}
      >
        <Button label="Delete draft" size="icon-composer">
          <TrashIcon />
        </Button>
        <Button label="Attach" size="icon-composer">
          <PaperclipIcon />
        </Button>
        <Button label="Format" size="icon-composer">
          <TextAa />
        </Button>
        <div class="min-w-0 max-w-[45%] shrink">
          <EmailDateSelector
            mobile={mobile}
            compact={mobile}
            sendTime={new Date('2026-09-30T23:59:00Z')}
            onSendTimeChange={() => true}
            trigger={
              mobile
                ? undefined
                : () => (
                    <span class="min-w-0 truncate text-sm">
                      {LONG_SCHEDULE_LABEL}
                    </span>
                  )
            }
          />
        </div>
        <SendButton
          appearance="composer"
          disabled
          tooltip="Already scheduled. Cancel or reschedule from the schedule control."
        />
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
