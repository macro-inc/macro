import { For, Match, Show, Switch } from 'solid-js';
import { productIntroductions } from '../../core/product-introductions';
import { ProductCopy } from '../ProductMention';
import './product-introduction.css';

/** Splits a paragraph into plain text, [[product mentions]], and *italics*. */
const parts = (paragraph: string) =>
  paragraph.split(/(\[\[.+?\]\]|\*.+?\*)/).filter(Boolean);

export function ProductIntroduction(props: { product: string }) {
  return (
    <Show when={productIntroductions[props.product]}>
      {(paragraphs) => (
        <div class="product-feature-intro product-introduction">
          <For each={paragraphs()}>
            {(paragraph) => (
              <p>
                <For each={parts(paragraph)}>
                  {(part) => (
                    <Switch fallback={part}>
                      <Match when={part.startsWith('[[')}>
                        <ProductCopy text={part.slice(2, -2)} />
                      </Match>
                      <Match when={part.startsWith('*')}>
                        <em>{part.slice(1, -1)}</em>
                      </Match>
                    </Switch>
                  )}
                </For>
              </p>
            )}
          </For>
        </div>
      )}
    </Show>
  );
}
