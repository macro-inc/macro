import { Match, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import type { AdoptedSignature, SignatureStyle } from '../core/packet';

/** Ink for marks on a PDF page, which is white in every theme. */
const SIGNATURE_INK = '#14213d';

/**
 * Cursive faces already on people's devices. Each style prefers a different
 * one and falls back to the platform's generic script.
 */
function signatureFontFamily(style: SignatureStyle): string {
  return match(style)
    .with(
      'script-1',
      () => "'Snell Roundhand', 'Segoe Script', 'Brush Script MT', cursive"
    )
    .with(
      'script-2',
      () => "'Brush Script MT', 'Lucida Handwriting', 'Apple Chancery', cursive"
    )
    .with(
      'script-3',
      () => "'Apple Chancery', 'Lucida Handwriting', 'Segoe Script', cursive"
    )
    .exhaustive();
}

/**
 * A recipient's adopted signature or initials. It fills the box it is put
 * in: typed marks scale their text to the box height, images fit inside it.
 */
export function SignatureMark(props: {
  mark: AdoptedSignature;
  label: string;
}) {
  return (
    <Switch>
      <Match when={props.mark.kind === 'typed' && props.mark}>
        {(typed) => (
          <span
            role="img"
            aria-label={props.label}
            class="flex size-full items-center [container-type:size]"
          >
            <span
              class="truncate leading-none"
              style={{
                color: SIGNATURE_INK,
                'font-family': signatureFontFamily(typed().style),
                'font-size': '72cqh',
              }}
            >
              {typed().text}
            </span>
          </span>
        )}
      </Match>
      <Match when={props.mark.kind !== 'typed' && props.mark}>
        {(image) => (
          <img
            src={image().dataUrl}
            alt={props.label}
            class="max-h-full max-w-full object-contain"
          />
        )}
      </Match>
    </Switch>
  );
}
