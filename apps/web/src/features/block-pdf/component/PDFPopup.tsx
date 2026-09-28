import type { IHighlight } from '@block-pdf/model/Highlight';
import { GeneralizedPopup } from '@core/component/GeneralizedPopup/Popup';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ChatIcon from '@phosphor-icons/core/regular/chat-teardrop.svg?component-solid';
import LinkIcon from '@phosphor-icons/core/regular/link.svg?component-solid';
import TrashIcon from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { Button } from '@ui';
import {
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { usePdfViewer } from '../context/pdf-viewer-context';

type PDFPopupProps = {
  highlightProps: {
    /** highlight the current selection */
    highlight: () => void;
    /** remove the highlight you're on */
    removeHighlight: () => void;
    /** are we currently on a highlight */
    currentHighlight?: IHighlight;
    /** can edit the current highlight */
    canEdit: boolean;
    /** can create a new highlight */
    canCreate: boolean;
  };
  commentProps: {
    /** place a comment on the current selection */
    placeComment: (e: MouseEvent) => void;
    /** can edit the current highlight to add a comment */
    canEdit: boolean;
    /** can create a new highlight comment */
    canCreate: boolean;
  };
  shareLinkProps?: {
    /** share the currently selected region of the document */
    share: () => void;
  };
  /** where to anchor the popup */
  anchorRef: HTMLElement;
};

// SCUFFED styling: how do we want to handle this color?
function HighlightIcon() {
  return <div class="size-4 bg-[oklch(0.905_0.182_98.111)] rounded-full"></div>;
}

export function PDFPopup(props: PDFPopupProps) {
  const pdf = usePdfDocument();
  const rootElement = usePdfViewer().rootElement;
  const blockId = pdf.documentId();

  onMount(() => {
    const stopSelectionChangePropagation = (event: Event) => {
      event.stopPropagation();
    };
    const blockElement = rootElement();
    blockElement?.addEventListener(
      'selectionchange',
      stopSelectionChangePropagation,
      { capture: true }
    );
    onCleanup(() => {
      blockElement?.removeEventListener(
        'selectionchange',
        stopSelectionChangePropagation,
        { capture: true }
      );
    });
  });

  const PDFPopupToolbar = () => {
    const [locationCopied, setLocationCopied] = createSignal(false);
    return (
      <div class="flex flex-row items-center space-x-2 justify-between w-full">
        <div class="flex flex-row space-x-2 items-center">
          <Switch>
            <Match when={!props.highlightProps.currentHighlight}>
              <Show when={props.highlightProps.canCreate}>
                <Button
                  variant="ghost"
                  size="icon-md"
                  onClick={() => {
                    props.highlightProps.highlight();
                  }}
                >
                  <HighlightIcon />
                </Button>
              </Show>
            </Match>
            <Match when={props.highlightProps.currentHighlight}>
              <Show when={props.highlightProps.canEdit}>
                <Button
                  variant="ghost"
                  size="icon-md"
                  onClick={() => {
                    props.highlightProps.removeHighlight();
                  }}
                >
                  <TrashIcon />
                </Button>
              </Show>
            </Match>
          </Switch>

          <Show
            when={
              props.highlightProps.currentHighlight
                ? props.commentProps.canEdit
                : props.commentProps.canCreate
            }
          >
            <Button
              variant="ghost"
              size="icon-md"
              onClick={(e: MouseEvent | KeyboardEvent) =>
                props.commentProps.placeComment(e as MouseEvent)
              }
            >
              <ChatIcon />
            </Button>
          </Show>
        </div>
        <Show when={props.shareLinkProps}>
          {(shareLinkProps) => (
            <Button
              variant="ghost"
              onClick={() => {
                setLocationCopied(true);
                shareLinkProps().share();
              }}
            >
              <Show
                when={locationCopied()}
                fallback={
                  <>
                    <LinkIcon />
                    Share
                  </>
                }
              >
                <CheckIcon class="text-success" />
                Copied
              </Show>
            </Button>
          )}
        </Show>
      </div>
    );
  };

  return (
    <GeneralizedPopup
      class="z-highlight-menu"
      anchor={{
        ref: props.anchorRef,
        blockId: `${blockId}`,
        blockType: 'pdf',
      }}
    >
      <PDFPopupToolbar />
    </GeneralizedPopup>
  );
}
