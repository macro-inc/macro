import {
  type ArtifactItem,
  type GraphicsDocument,
  type GraphicsEditor,
  presentationOrder,
  resolveSlideTransition,
  setArtifactCommand,
} from '@macro-inc/graphics';
import { createSignal, Show } from 'solid-js';
import { TransitionInspector } from '../../components/transition-inspector';
import { usePresentation } from '../../context/presentation';
import { TransitionPreview } from './transition-preview';

/** The selected slide's transition, edited through the editor's commands and
 * the canvas's deck default, with an in-place preview. */
export function SlideTransitionInspector(props: {
  editor: GraphicsEditor;
  document: GraphicsDocument;
  slide: ArtifactItem;
}) {
  const presentation = usePresentation();
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
          ? () => presentation.setDeckDefault?.(own() ?? effective(), true)
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
              document={props.document}
              slides={presentationOrder(props.document)}
              slide={props.slide}
              deckDefault={presentation.deckDefault()}
            />
          )}
        </Show>
      }
    />
  );
}
