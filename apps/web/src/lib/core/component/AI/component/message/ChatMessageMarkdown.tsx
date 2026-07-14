// import '@core/component/AI/css/prism-theme.css';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import type { EditorState } from 'lexical';
import type { Accessor } from 'solid-js';

function sliceUnclosedBrackets(text: string): string {
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    if (text.at(i) === '[') stack.push(['[', i]);
    if (text.at(i) === ']' && stack.length > 0) stack.pop();
  }
  if (stack.length === 0) {
    return text;
  } else {
    const lastOpenBracket = stack[0][1] as number;
    return text.slice(0, lastOpenBracket);
  }
}

export function ChatMessageMarkdown(props: {
  text: string;
  generating: Accessor<boolean>;
  rootRef?: (ref: HTMLDivElement) => void;
  /* receives this message's parsed editor state accessor */
  setStateRef?: (
    state: Accessor<EditorState | null> | undefined,
    key?: string
  ) => void;
  stateRefKey?: string;
}) {
  const text = () => {
    if (props.generating()) {
      const text = props.text.replace(/\[\[.*?\]\]/g, '');
      return sliceUnclosedBrackets(text);
    } else {
      return props.text;
    }
  };

  return (
    <StaticMarkdown
      markdown={text()}
      theme={aiChatTheme}
      rootRef={props.rootRef}
      setStateRef={props.setStateRef}
      stateRefKey={props.stateRefKey}
      target="internal"
    />
  );
}
