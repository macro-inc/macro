import { Color } from '@block-pdf/model/Color';
import { activePlaceableIdSignal } from '@block-pdf/signal/placeables';
import {
  useDeletePlaceable,
  useModifyPayload,
} from '@block-pdf/store/placeables';
import {
  type AllowableEdits,
  type ITextBox,
  PayloadMode,
} from '@block-pdf/type/placeables';
import { createCallback } from '@solid-primitives/rootless';
import { createEffect, createSignal, type JSX, type Ref } from 'solid-js';

interface TextBoxProps {
  id: string;
  payload: ITextBox;
  isActive: boolean;
  allowableEdits: AllowableEdits;
  ref: Ref<HTMLTextAreaElement>;
  initialWidth: number;
  initialHeight: number;
}

export function TextBox(props: TextBoxProps) {
  let textAreaRef!: HTMLTextAreaElement;
  const [text, setText] = createSignal(props.payload.text);
  const setActivePlaceable = activePlaceableIdSignal.set;

  const modifyPayload = useModifyPayload();
  const deletePlaceable = useDeletePlaceable();

  const textStyling = (): JSX.CSSProperties => {
    return {
      'font-size': `${props.payload.fontSize}px`,
      color: Color.toRgbaString(props.payload.color),
      'font-family': props.payload.fontFamily,
      'text-decoration': props.payload.underlined ? 'underline' : 'none',
      'font-weight': props.payload.bold ? 'bold' : 'normal',
      'font-style': props.payload.italic ? 'italic' : 'normal',
      'line-height': '1.35',
      'box-shadow': 'none',
      border: 'none',
      'outline-offset': '0',
      outline: props.isActive ? `1px dotted grey` : 'none',
      width: `${props.initialWidth}px`,
      height: `${props.initialHeight}px`,
    };
  };

  const readOnly = () => !props.isActive || props.allowableEdits === 'locked';

  createEffect(() => {
    if (props.isActive && !readOnly()) {
      textAreaRef.focus();
    }
  });

  const updatePlaceable = createCallback(() => {
    if (!text().trim()) {
      deletePlaceable(props.id);
      return;
    }

    if (text() !== props.payload.text) {
      modifyPayload(props.id, PayloadMode.FreeTextAnnotation, {
        text: text(),
      });
    }
  });

  return (
    <textarea
      class={`p-0 overflow-hidden whitespace-pre-wrap rounded-sm ${readOnly() ? 'resize-none' : 'resize'}`}
      style={textStyling()}
      ref={(el) => {
        if (typeof props.ref === 'function') {
          props.ref(el);
        } else {
          props.ref = el;
        }
        textAreaRef = el;
      }}
      placeholder="Text"
      value={text()}
      readOnly={readOnly()}
      onInput={(e) => setText(e.currentTarget.value)}
      onBlur={() => {
        updatePlaceable();
        setActivePlaceable(undefined);
      }}
    />
  );
}
