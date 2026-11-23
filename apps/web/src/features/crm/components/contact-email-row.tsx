import { t } from '@app/lib/i18n';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import PushPinIcon from '@icon/system/regular/push-pin.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { Badge, Button, cn, Tooltip } from '@ui';
import { Show } from 'solid-js';

/** The primary address's badge, at the size of the row it sits in. */
function ContactEmailPrimaryBadge() {
  return (
    <Badge variant="ghost" size="xs" class="shrink-0 border-0 pl-1.5 pr-0">
      {t('crm.primaryEmail')}
    </Badge>
  );
}

/**
 * One address and the actions it can take: Remove, unless the address links
 * the contact to its company, then Make primary, unless it is the primary
 * (the side panel's remove-then-pin order). A row reserves no room for them:
 * on desktop they take room only while the pointer is on the row or focus is
 * in it, so the address ends in an ellipsis and Primary stays; on touch they
 * always show.
 */
export function ContactEmailRow(props: {
  email: string;
  primary: boolean;
  linksCompany: boolean;
  /** Whether the server listed the addresses, so they can be changed. */
  manageable: boolean;
  busy: boolean;
  /** The editor's rows use the body text and are roomier. */
  size: 'details' | 'editor';
  /** Record details opens the email editor from the address. */
  onOpen?: (anchor: HTMLButtonElement) => void;
  /** The address's button, where focus goes once it becomes primary. */
  addressRef?: (element: HTMLButtonElement) => void;
  /** Whether the email editor is open from this address. */
  expanded?: boolean;
  onMakePrimary(): void;
  onRemove(): void;
}) {
  const canRemove = () => props.manageable && !props.linksCompany;
  const canMakePrimary = () => props.manageable && !props.primary;
  const faceClass = () =>
    cn(
      'inline-flex min-w-0 items-center rounded-full text-left outline-none',
      props.size === 'editor'
        ? 'h-8 gap-2 px-2 text-sm text-ink touch:h-11'
        : 'h-6 gap-1 pl-2 text-xs text-ink-muted touch:h-9',
      props.manageable && 'not-touch:group-hover/address:text-ink'
    );
  const face = () => (
    <>
      <EnvelopeIcon
        class={cn('shrink-0', props.size === 'editor' ? 'size-3.5' : 'size-3')}
      />
      <span class="ph-no-capture min-w-0 truncate">{props.email}</span>
    </>
  );

  return (
    <div
      class={cn(
        'group/address flex min-w-0 items-center rounded-full',
        props.manageable &&
          'not-touch:hover:bg-button-tertiary-hover not-touch:focus-within:bg-button-tertiary-hover'
      )}
    >
      <Show
        when={props.manageable && props.onOpen}
        fallback={<span class={faceClass()}>{face()}</span>}
      >
        {(open) => (
          <Tooltip label={props.email} class="min-w-0">
            <button
              ref={(element) => props.addressRef?.(element)}
              type="button"
              class={cn(
                faceClass(),
                'ph-no-capture focus-visible:ring-2 focus-visible:ring-accent/20'
              )}
              aria-label={t('crm.manageContactEmail', { email: props.email })}
              aria-haspopup="dialog"
              aria-expanded={props.expanded ?? false}
              onClick={(event) => open()(event.currentTarget)}
            >
              {face()}
            </button>
          </Tooltip>
        )}
      </Show>
      <Show when={props.primary}>
        <ContactEmailPrimaryBadge />
      </Show>
      <Show when={canRemove() || canMakePrimary()}>
        <div class="ml-auto flex shrink-0 items-center gap-0.5 overflow-hidden pr-0.5 not-touch:w-0 not-touch:pr-0 not-touch:group-hover/address:w-auto not-touch:group-hover/address:pr-0.5 not-touch:group-focus-within/address:w-auto not-touch:group-focus-within/address:pr-0.5">
          <Show when={canRemove()}>
            <Button
              variant="danger-ghost"
              size="icon-xs"
              class="ph-no-capture focus-visible:ring-2 focus-visible:ring-accent/20"
              aria-label={t('crm.removeContactEmailNamed', {
                email: props.email,
              })}
              tooltip={t('crm.removeContactEmail')}
              disabled={props.busy}
              onClick={() => props.onRemove()}
            >
              <TrashIcon class="size-4" />
            </Button>
          </Show>
          <Show when={canMakePrimary()}>
            <Button
              variant="ghost"
              size="icon-xs"
              class="ph-no-capture text-ink-extra-muted not-data-disabled:focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/20"
              aria-label={t('crm.makeContactEmailPrimaryNamed', {
                email: props.email,
              })}
              tooltip={t('crm.makePrimaryContactEmail')}
              disabled={props.busy}
              onClick={() => props.onMakePrimary()}
            >
              <PushPinIcon class="size-4" />
            </Button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
