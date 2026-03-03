import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import {
  editorStateAsMarkdown,
  initializeEditorEmpty,
} from '@core/component/LexicalMarkdown/utils';
import type { LexicalEditor } from 'lexical';
import { createSignal, onCleanup, type Accessor } from 'solid-js';

export type InputController = {
  value: Accessor<string>;
  mentions: Accessor<ItemMention[]>;
  clear: () => void;
};

type InputControllerProps = {
  initialValue?: string;
  lexicalEditor: LexicalEditor;
  mentions?: Accessor<ItemMention[]>;
};

export function createInputController(
  props: InputControllerProps
): InputController {
  const [value, setValue] = createSignal(props.initialValue ?? '');
  const [internalMentions, setInternalMentions] = createSignal<ItemMention[]>(
    []
  );
  const mentions = () => props.mentions?.() ?? internalMentions();

  const unsubscribe = props.lexicalEditor.registerUpdateListener(
    ({ editorState }) => {
      setValue(editorStateAsMarkdown(editorState));
    }
  );

  onCleanup(() => {
    unsubscribe();
  });

  const clear = () => {
    initializeEditorEmpty(props.lexicalEditor);
    setValue('');
    if (!props.mentions) {
      setInternalMentions([]);
    }
  };

  return {
    value,
    mentions,
    clear,
  };
}
