import { For, Show } from 'solid-js';
import { productIntroductions } from '../../core/product-introductions';
import './product-introduction.css';

export function ProductIntroduction(props: { product: string }) {
  return (
    <Show when={productIntroductions[props.product]}>
      {(paragraphs) => (
        <div class="product-feature-intro product-introduction">
          <For each={paragraphs()}>{(paragraph) => <p>{paragraph}</p>}</For>
        </div>
      )}
    </Show>
  );
}
