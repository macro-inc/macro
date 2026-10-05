import ArrowLeft from '@phosphor/arrow-left.svg';
import FileText from '@phosphor/file-text.svg';
import Share from '@phosphor/share.svg';
import { Button } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { ViewShell } from '../DemoWorkspaceChrome';
import { DemoTags } from '../workspace/frozen/DemoTags';
import { DetailLayout, PanelToggle } from '../workspace/frozen/DetailPanel';
import { DocumentShareSheet, LAUNCH_MEMBERS } from './DocumentShareSheet';
import '../workspace/dummy-workspace.css';
import '../demo-markdown.css';
import './document-stories.css';

/**
 * The open-document view shared by the Docs page demos: the same top bar,
 * title, tags row, and side panel as the sample workspace's document view,
 * with the body handed to each demo so it can animate edits in place.
 */
export function DocumentFrame(props: {
  title: string;
  tags?: readonly string[];
  /** Header island before Share, e.g. the offline indicator. */
  status?: JSX.Element;
  panel?: JSX.Element;
  panelOpen?: boolean;
  onPanelChange?: (open: boolean) => void;
  /** Replaces the built-in Share modal, which lists #launch's access. */
  onShare?: () => void;
  onBack?: () => void;
  backLabel?: string;
  /** Cursors and menus, positioned over the window. */
  overlay?: JSX.Element;
  children: JSX.Element;
}) {
  const [tags, setTags] = createSignal<string[]>([...(props.tags ?? [])]);
  const [panel, setPanel] = createSignal<boolean>();
  const [sharing, setSharing] = createSignal(false);
  // A visitor's toggle wins over the walkthrough's panel state.
  const open = () => panel() ?? props.panelOpen ?? false;
  return (
    <>
      <ViewShell.TopBar>
        <Show when={props.onBack}>
          {(back) => (
            <Button
              variant="plain"
              size="icon-sm"
              label={props.backLabel ?? 'Back'}
              onClick={() => back()()}
            >
              <ArrowLeft />
            </Button>
          )}
        </Show>
        <FileText class="size-4 shrink-0 text-note" />
        <span class="text-sm truncate">{props.title}</span>
        <div class="ml-auto flex items-center gap-1">
          {props.status}
          <Button
            size="sm"
            data-doc-share
            onClick={() => (props.onShare ? props.onShare() : setSharing(true))}
          >
            <Share />
            Share
          </Button>
          <PanelToggle
            open={open()}
            onChange={(next) => {
              setPanel(next);
              props.onPanelChange?.(next);
            }}
          />
        </div>
      </ViewShell.TopBar>
      <DetailLayout open={open()} panel={props.panel}>
        <div class="dummy-scroll px-6 doc-story-scroll">
          <div class="doc-story-page">
            <div
              role="textbox"
              aria-label="Document title"
              contentEditable
              class="doc-story-title"
            >
              {props.title}
            </div>
            <Show when={props.tags}>
              <div class="doc-story-tags">
                <DemoTags tags={tags()} onChange={setTags} />
              </div>
            </Show>
            <div
              contentEditable
              role="textbox"
              aria-label="Document body"
              aria-multiline="true"
              class="doc-story-body website-demo-markdown md"
            >
              {props.children}
            </div>
          </div>
        </div>
      </DetailLayout>
      <Show when={!props.onShare}>
        <DocumentShareSheet
          open={sharing()}
          title={props.title}
          channel={{ members: LAUNCH_MEMBERS, level: 'view' }}
          onClose={() => setSharing(false)}
        />
      </Show>
      {props.overlay}
    </>
  );
}
