import { t } from '@app/lib/i18n';
import SignatureIcon from '@icon/system/regular/signature.svg';
import { Checkbox, Input } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { isMark } from '../core/fields';
import type { PacketField, Recipient } from '../core/packet';
import { fieldKindLabel } from './field-kind';
import { formatDayWithYear } from './format';
import { SignatureMark } from './signature-mark';
import { type Tone, toneVars } from './tone';

/** What a signed or auto-filled field prints, if anything. */
function printedValue(
  field: PacketField,
  recipient: Recipient
): string | undefined {
  if (field.kind === 'date_signed') {
    return recipient.signedAt
      ? formatDayWithYear(recipient.signedAt)
      : undefined;
  }
  if (field.kind === 'full_name') return recipient.name;
  if (field.kind === 'email') return recipient.email;
  return typeof field.value === 'string' ? field.value : undefined;
}

function Positioned(props: {
  field: PacketField;
  tone: Tone;
  children: JSX.Element;
}) {
  return (
    <div
      class="absolute flex items-center text-[1.9cqw]"
      data-field-id={props.field.id}
      style={{
        ...toneVars(props.tone),
        left: `${props.field.box.xPct * 100}%`,
        top: `${props.field.box.yPct * 100}%`,
        width: `${props.field.box.widthPct * 100}%`,
        height: `${props.field.box.heightPct * 100}%`,
      }}
    >
      {props.children}
    </div>
  );
}

/**
 * A field as it reads on the document: a recipient's mark, the text they
 * entered, or nothing while it is still empty.
 */
export function FilledField(props: {
  field: PacketField;
  recipient: Recipient;
}) {
  /** The recipient's mark, once they have signed a signature or initials field. */
  const signedMark = () => {
    if (!isMark(props.field.kind) || !props.recipient.signedAt)
      return undefined;
    return props.field.kind === 'signature'
      ? props.recipient.signature
      : props.recipient.initials;
  };

  return (
    <Positioned field={props.field} tone="neutral">
      <Switch>
        <Match when={signedMark()}>
          {(adopted) => (
            <SignatureMark
              mark={adopted()}
              label={t('contracts.markOf', {
                field: fieldKindLabel(props.field.kind),
                name: props.recipient.name,
              })}
            />
          )}
        </Match>
        <Match
          when={props.field.kind === 'checkbox' && props.field.value === true}
        >
          <span class="font-semibold text-[#1c1c1c]">✓</span>
        </Match>
        <Match
          when={
            props.recipient.signedAt
              ? printedValue(props.field, props.recipient)
              : undefined
          }
        >
          {(value) => <span class="truncate text-[#1c1c1c]">{value()}</span>}
        </Match>
      </Switch>
    </Positioned>
  );
}

/**
 * A field the signer is working through. Marks open the signature step,
 * text and checkboxes are entered in place, and the date, name, and email
 * show what signing will print.
 */
export function SigningField(props: {
  field: PacketField;
  recipient: Recipient;
  tone: Tone;
  /** The signer's adopted mark for this field, once chosen. */
  mark?: Recipient['signature'];
  value: string | boolean | undefined;
  /** The next field the signer should complete. */
  current: boolean;
  onSign: () => void;
  onValue: (value: string | boolean) => void;
}) {
  return (
    <Positioned field={props.field} tone={props.tone}>
      <Switch>
        <Match when={isMark(props.field.kind) && props.mark}>
          {(adopted) => (
            <button
              type="button"
              class="flex size-full items-center rounded-[0.6cqw] px-[0.6cqw] outline-none not-touch:hover:bg-(--tone-bg) focus-visible:ring-2 focus-visible:ring-(--tone)"
              aria-label={t('contracts.changeMark', {
                field: fieldKindLabel(props.field.kind),
              })}
              onClick={() => props.onSign()}
            >
              <SignatureMark
                mark={adopted()}
                label={fieldKindLabel(props.field.kind)}
              />
            </button>
          )}
        </Match>
        <Match when={isMark(props.field.kind)}>
          <button
            type="button"
            class="flex size-full items-center justify-center gap-[0.8cqw] rounded-[0.8cqw] border-2 border-(--tone) bg-(--tone-bg) font-bold text-(--tone-print) outline-none focus-visible:ring-2 focus-visible:ring-(--tone)"
            classList={{ 'ring-4 ring-(--tone)/25': props.current }}
            onClick={() => props.onSign()}
          >
            <SignatureIcon class="size-[2.4cqw] shrink-0" />
            <span class="truncate">
              {props.field.kind === 'signature'
                ? t('contracts.signHere')
                : t('contracts.initialHere')}
            </span>
          </button>
        </Match>
        <Match when={props.field.kind === 'text'}>
          <Input
            variant="bare"
            size="xs"
            class="size-full rounded-[0.6cqw] border-[1.5px] border-(--tone) bg-(--tone-bg) px-[0.9cqw] text-[1.9cqw] text-[#1c1c1c]"
            aria-label={fieldKindLabel(props.field.kind)}
            aria-required={props.field.required}
            value={typeof props.value === 'string' ? props.value : ''}
            onInput={(event) => props.onValue(event.currentTarget.value)}
          />
        </Match>
        <Match when={props.field.kind === 'checkbox'}>
          <Checkbox
            size="sm"
            checked={props.value === true}
            onChange={(checked) => props.onValue(checked)}
            aria-label={fieldKindLabel(props.field.kind)}
          >
            <Checkbox.Control />
          </Checkbox>
        </Match>
        <Match when={true}>
          <span class="truncate border-b border-[#1c1c1c]/40 text-[#555555]">
            <Show
              when={printedValue(props.field, props.recipient)}
              fallback={t('contracts.filledWhenYouSign')}
            >
              {(value) => value()}
            </Show>
          </span>
        </Match>
      </Switch>
    </Positioned>
  );
}
