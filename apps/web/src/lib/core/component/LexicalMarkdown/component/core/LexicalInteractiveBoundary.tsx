import { stopLexicalPropagation } from 'lexical';
import type { JSX } from 'solid-js';

/** Let embedded controls handle editing without sending their events to outer Lexical. */
export function LexicalInteractiveBoundary(props: { children: JSX.Element }) {
  return (
    <div
      data-lexical-interactive
      // Native listeners mark events before they reach Lexical's root, while
      // preserving browser defaults and Solid's delegated handlers.
      on:keydown={stopLexicalPropagation}
      on:beforeinput={stopLexicalPropagation}
      on:input={stopLexicalPropagation}
      on:compositionstart={stopLexicalPropagation}
      on:compositionend={stopLexicalPropagation}
      on:paste={stopLexicalPropagation}
      on:copy={stopLexicalPropagation}
      on:cut={stopLexicalPropagation}
      on:drop={stopLexicalPropagation}
      on:dragstart={stopLexicalPropagation}
      on:click={stopLexicalPropagation}
    >
      {props.children}
    </div>
  );
}
