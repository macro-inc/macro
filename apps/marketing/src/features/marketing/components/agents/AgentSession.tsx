import Share from '@phosphor/share.svg';
import Sidebar from '@phosphor/sidebar-simple.svg';
import { Button } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { ViewShell } from '../DemoWorkspaceChrome';
import { DocumentShareSheet } from '../documents/DocumentShareSheet';
import '../documents/document-stories.css';
import { ModelIcon } from '../workspace/frozen/model-picker/ProviderIcon';
import { AgentComposer } from './AgentComposer';
import './agent-stories.css';

/** AgentSessionPane presentation at 40ceda68. Sharing is a local preview. */
export function AgentSession(props: {
  title: string;
  children: JSX.Element;
  onSend: (prompt: string) => void;
}) {
  let shareButton: HTMLButtonElement | undefined;
  const [model, setModel] = createSignal('claude-sonnet-5-5');
  const [share, setShare] = createSignal(false);
  const [details, setDetails] = createSignal(false);
  return (
    <>
      <ViewShell.TopBar class="agent-session-header">
        <ModelIcon model={model()} />
        <h3 class="min-w-0 flex-1 truncate text-sm font-semibold">
          {props.title}
        </h3>
        <Button
          ref={shareButton}
          variant="plain"
          size="sm"
          onClick={() => setShare(true)}
        >
          <Share class="size-4" />
          Share
        </Button>
        <Button
          variant="plain"
          size="icon-sm"
          label="Toggle agent details"
          aria-expanded={details()}
          onClick={() => setDetails(!details())}
        >
          <Sidebar class="size-4" />
        </Button>
      </ViewShell.TopBar>
      <div class="agent-session-body">
        <div
          class="dummy-scroll agent-transcript"
          role="log"
          aria-label={props.title}
        >
          {props.children}
        </div>
        <Show when={details()}>
          <aside class="agent-session-details" aria-label="Agent details">
            <Button variant="plain" size="sm" onClick={() => setDetails(false)}>
              Close details
            </Button>
            <h4>Properties</h4>
            <dl>
              <dt>Created by</dt>
              <dd>Jacob</dd>
              <dt>Agent</dt>
              <dd>Macro</dd>
            </dl>
          </aside>
        </Show>
      </div>
      <div class="dummy-composer sample-chat-composer agent-session-composer">
        <AgentComposer
          onSend={props.onSend}
          model={model()}
          onModelChange={setModel}
        />
      </div>
      <DocumentShareSheet
        open={share()}
        title={props.title}
        entityLabel="conversation"
        autoFocus
        onClose={() => {
          setShare(false);
          shareButton?.focus();
        }}
      />
    </>
  );
}
