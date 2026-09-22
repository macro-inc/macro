import './PostDiagram.css';
import { For, type JSX, Show } from 'solid-js';

/**
 * Boxes-and-arrows diagrams for engineering posts, drawn with the site's
 * theme tokens so they render dark-mode native instead of as baked images.
 */

/** A labelled box inside a diagram. `items` renders as a mono list; `note`
 * as a short sentence. Dashed boxes are annotations rather than components. */
export function DiagramBox(props: {
  title: string;
  items?: string[];
  note?: string;
  dashed?: boolean;
}) {
  return (
    <div classList={{ 'pdg-box': true, 'pdg-box--dashed': !!props.dashed }}>
      <div class="pdg-box-title">{props.title}</div>
      <Show when={props.items?.length}>
        <ul class="pdg-box-items">
          <For each={props.items}>{(item) => <li>{item}</li>}</For>
        </ul>
      </Show>
      <Show when={props.note}>
        <p class="pdg-box-note">{props.note}</p>
      </Show>
    </div>
  );
}

export function DiagramArrow() {
  return (
    <span class="pdg-arrow" aria-hidden="true">
      ↔
    </span>
  );
}

/** Diagram frame. The boxes-and-arrows content is decorative for assistive
 * tech (`role="img"`); `alt` carries the meaning, the caption sits below. */
export function Diagram(props: {
  title: string;
  alt: string;
  caption: string;
  children: JSX.Element;
}) {
  return (
    <figure class="pdg-figure">
      <div class="pdg-diagram" role="img" aria-label={props.alt}>
        <div class="pdg-diagram-title">{props.title}</div>
        {props.children}
      </div>
      <figcaption class="pdg-figcaption">{props.caption}</figcaption>
    </figure>
  );
}
