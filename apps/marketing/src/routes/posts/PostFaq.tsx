import CaretDownIcon from '@phosphor/caret-down.svg';
import type { JSX } from 'solid-js';

export function PostFaqItem(props: {
  question: string;
  children: JSX.Element;
}) {
  return (
    <details class="post-faq__item">
      <summary>
        <span>{props.question}</span>
        <CaretDownIcon aria-hidden="true" />
      </summary>
      <div class="post-faq__answer">{props.children}</div>
    </details>
  );
}
