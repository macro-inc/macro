import { For, Show } from 'solid-js';
import { productIntroductions } from '../../core/product-introductions';
import './product-introduction.css';

export function ProductIntroduction(props: { product: string }) {
  return (
    <Show when={productIntroductions[props.product]}>
      {(paragraphs) => (
        <div class="product-feature-intro product-introduction">
          <For each={paragraphs()}>
            {(paragraph) => (
              <p>
                <For each={paragraph.split('**')}>
                  {(text, index) => (
                    <Show when={index() % 2 === 1} fallback={text}>
                      <strong>{text}</strong>
                    </Show>
                  )}
                </For>
              </p>
            )}
          </For>
          <Show when={props.product === 'Tasks'}>
            <div class="product-introduction-videos">
              <a href="/posts/linear-alternative">
                <img
                  src="/og/linear-alternative.png"
                  alt=""
                  width="80"
                  height="45"
                />
                <span>Macro vs. Linear</span>
              </a>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
