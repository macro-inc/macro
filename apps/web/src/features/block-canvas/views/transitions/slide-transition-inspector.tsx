import {
  type ArtifactItem,
  type GraphicsEditor,
  presentationOrder,
  resolveSlideTransition,
  setArtifactCommand,
} from '@macro-inc/graphics';
import { createSignal, onCleanup, Show } from 'solid-js';
import { TransitionInspector } from '../../components/transition-inspector';
import { usePresentation } from '../../context/presentation';
import { deckDefaultForAll } from '../../core/transitions/transition-edits';
import { TransitionPreview } from './transition-preview';

/** The selected slide's transition, edited through the editor's commands and
 * the canvas's deck default, with an in-place preview. */
export function SlideTransitionInspector(props: {
  editor: GraphicsEditor;
  slide: ArtifactItem;
}) {
  const presentation = usePresentation();
  // The editor's own frozen snapshots: the preview's canvas render builds a
  // read-only editor from one.
  const [document, setDocument] = createSignal(props.editor.document);
  onCleanup(props.editor.subscribeDocument(setDocument));
  // Which slide was last previewed, and a count that remounts the preview.
  const [preview, setPreview] = createSignal<{ id: string; count: number }>();
  const own = () => props.slide.geometry.transition;
  const effective = () =>
    resolveSlideTransition(own(), presentation.deckDefault());

  return (
    <TransitionInspector
      own={own()}
      deckDefault={presentation.deckDefault()}
      effective={effective()}
      onChange={(transition) =>
        props.editor.execute(setArtifactCommand, {
          id: props.slide.id,
          content: { transition: transition ?? null },
        })
      }
      onApplyToAll={
        presentation.setDeckDefault
          ? () =>
              presentation.setDeckDefault?.(
                deckDefaultForAll(own(), presentation.deckDefault()),
                true
              )
          : undefined
      }
      onSetDeckDefault={
        presentation.setDeckDefault
          ? () => {
              const transition = own();
              if (transition) presentation.setDeckDefault?.(transition, false);
            }
          : undefined
      }
      onPreview={() =>
        setPreview((last) => ({
          id: props.slide.id,
          count: last?.id === props.slide.id ? last.count + 1 : 1,
        }))
      }
      preview={
        <Show
          when={preview()?.id === props.slide.id ? preview() : undefined}
          keyed
        >
          {(_run) => (
            <TransitionPreview
              document={document()}
              slides={presentationOrder(document())}
              slide={props.slide}
              deckDefault={presentation.deckDefault()}
            />
          )}
        </Show>
      }
    />
  );
}
