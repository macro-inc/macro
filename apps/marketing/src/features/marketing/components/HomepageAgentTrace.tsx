import CursorIcon from '@icon/wide-cursor-ide.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Tabs } from '@ui/components/Tabs';
import { UserMessageBubble } from '@ui/components/UserMessageBubble';
import { Show } from 'solid-js';
import { DEPLOY_PROMPT, DEPLOY_TRACE } from '../core/deploy-agent-demo';
import { AgentMessage } from './DemoAgentMessage';
import { TextPart } from './DemoMarkdown';
import { DemoPrDocument } from './DemoPrDocument';

export default function HomepageAgentTrace(props: {
  view: 'trace' | 'pr';
  merged?: boolean;
  onView: (view: 'trace' | 'pr') => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <Dialog
      open
      position="center"
      animate
      class="homepage-agent-dialog workspace-demo glass"
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      <header class="homepage-agent-dialog-header">
        <CursorIcon class="size-6 shrink-0" />
        <div class="min-w-0 flex-1">
          <Dialog.Title class="truncate text-base font-medium">
            Fix the deploy pipeline
          </Dialog.Title>
          <Dialog.Description class="mt-1 text-xs text-ink-muted">
            Cursor · Auto · Sample session
          </Dialog.Description>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close agent trace"
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
      </header>
      <div class="homepage-agent-dialog-tabs">
        <Tabs
          aria-label="Agent session views"
          list={[
            { value: 'trace', label: 'Agent trace' },
            { value: 'pr', label: 'Pull request #482' },
          ]}
          value={props.view}
          onChange={(value) => props.onView(value === 'pr' ? 'pr' : 'trace')}
        />
        <span class="text-xs text-ink-extra-muted">Done</span>
      </div>
      <div class="homepage-agent-dialog-body">
        <Show
          when={props.view === 'trace'}
          fallback={<DemoPrDocument merged={props.merged} />}
        >
          <div class="mb-8 flex w-full flex-col items-end">
            <UserMessageBubble>
              <TextPart text={DEPLOY_PROMPT} />
            </UserMessageBubble>
          </div>
          <div class="mb-4 flex items-center gap-2 text-sm font-medium">
            <CursorIcon class="size-4" />
            Cursor
          </div>
          <AgentMessage message={DEPLOY_TRACE} inFlight={false} />
        </Show>
      </div>
    </Dialog>
  );
}
