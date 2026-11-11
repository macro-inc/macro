import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
import PhoneIcon from '@icon/system/regular/phone.svg';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { Badge } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { readablePhone } from '../core/contact';
import { ContactPhonesDialog } from './contact-phones-dialog';
import { contactPropertyTouchTarget } from './contact-property-styles';

const linkClasses = () =>
  propertyPillClasses({ class: contactPropertyTouchTarget });

/**
 * A number calls through the device's own dialer. On a phone the whole pill
 * dials; on a larger screen the number sits beside a Call link.
 */
function PhonePill(props: { phone: string }) {
  const href = () => `tel:${props.phone}`;
  const number = () => readablePhone(props.phone);
  return (
    <Show
      when={!isMobile()}
      fallback={
        <a
          href={href()}
          aria-label={t('crm.callPhone', { phone: number() })}
          class={linkClasses()}
        >
          <PhoneIcon class="size-3 shrink-0" />
          {number()}
        </a>
      }
    >
      <span class="inline-flex items-center gap-1">
        <Badge variant="ghost" size="sm">
          <PhoneIcon class="size-3 shrink-0" />
          {number()}
        </Badge>
        <a
          href={href()}
          aria-label={t('crm.callPhone', { phone: number() })}
          class={linkClasses()}
        >
          {t('crm.callContact')}
        </a>
      </span>
    </Show>
  );
}

/** A contact's numbers, and the pill that edits them once they have loaded. */
export function ContactPhonesProperty(props: {
  phones?: string[];
  errorMessage: (error: unknown) => string;
  save: (phones: string[]) => Promise<void>;
}) {
  const [editing, setEditing] = createSignal(false);
  return (
    <>
      <For each={props.phones}>{(phone) => <PhonePill phone={phone} />}</For>
      <Show when={props.phones}>
        {(phones) => (
          <button
            type="button"
            onClick={() => setEditing(true)}
            class={propertyPillClasses({
              empty: !phones().length,
              class: contactPropertyTouchTarget,
            })}
          >
            <PhoneIcon class="size-3 shrink-0" />
            {phones().length ? t('crm.editPhones') : t('crm.addPhone')}
          </button>
        )}
      </Show>
      <Show when={editing()}>
        <ContactPhonesDialog
          initial={props.phones ?? []}
          errorMessage={props.errorMessage}
          onSave={props.save}
          onClose={() => setEditing(false)}
        />
      </Show>
    </>
  );
}
