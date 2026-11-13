import { Match, Switch } from 'solid-js';
import type { AdoptedSignature } from '../core/packet';
import { SIGNATURE_INK, signatureFontFamily } from '../core/signature-style';

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
