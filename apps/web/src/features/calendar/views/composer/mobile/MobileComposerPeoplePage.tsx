import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { UserIcon } from '@core/component/UserIcon';
import { emailToId } from '@core/user';
import CloseIcon from '@icon/system/regular/x.svg';
import { useQuickAccessEntities } from '@property/editors/selectors/entityUtils';
import { useTeamAvailabilityQuery } from '@queries/calendar/team-availability';
import { Button, Input } from '@ui';
import * as EmailValidator from 'email-validator';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { BusyIndicator } from '../../../components/busy-indicator/BusyIndicator';
import type { SelectedEventEditorGuest } from '../../../components/composer/event-form-model';
import { PhoneMenuChoice } from '../../../components/composer/phone-menu/PhoneMenuChoice';
import { PhoneMenuPage } from '../../../components/composer/phone-menu/PhoneMenuPage';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';
import {
  composerGuestName,
  composerGuestUser,
} from '../../../core/composer-guests';
import { composerAvailabilityRange } from '../../../primitives/composer-availability-range';
import { createComposerGuestAdditions } from '../../../primitives/create-composer-guest-additions';
import { createComposerGuestSelection } from '../../../primitives/create-composer-guest-selection';

export function MobileComposerPeoplePage(props: {
  current: () => SelectedEventEditorGuest[];
  added: () => SelectedEventEditorGuest[];
  onAddedChange: (added: SelectedEventEditorGuest[]) => void;
}) {
  const model = useCalendarComposer();
  const menus = usePhoneComposerMenu();
  const [search, setSearch] = createSignal('');
  const [draft, setDraft] = createSignal(props.added());
  const disabled = () => model.guests.disabled || model.guests.readOnly;
  const changes = createComposerGuestAdditions({
    current: props.current,
    added: draft,
    disabled,
    onChange: setDraft,
  });
  const selection = createComposerGuestSelection({
    options: model.guests.options,
    selected: draft,
    excluded: props.current,
    onChange: changes.replace,
  });
  const source = useQuickAccessEntities(
    () => 'USER',
    search,
    () => !disabled(),
    selection.excludedIds
  );
  const users = createMemo(() => {
    const found = new Map(source.items().map((item) => [item.id, item.data]));
    for (const user of selection.users())
      if (!found.has(user.id)) found.set(user.id, user);
    const text = search().trim().toLowerCase();
    return [...found.values()].filter((user) => {
      if (selection.excludedIds().has(user.id)) return false;
      if (EmailValidator.validate(text))
        return user.email.toLowerCase() === text;
      return (
        !text || `${user.name ?? ''} ${user.email}`.toLowerCase().includes(text)
      );
    });
  });
  const availability = useTeamAvailabilityQuery(
    () => composerAvailabilityRange(model.range, model.timeZone()),
    () => users().map((user) => user.id)
  );
  usePending('calendar.guest-availability', () => availability.isLoading);
  const busyIds = createMemo(
    () =>
      new Set(
        availability.isSuccess
          ? availability.data.members
              .filter((member) => member.busy.length > 0)
              .map((member) => member.userId)
          : []
      )
  );
  const custom = () => {
    const email = search().trim();
    if (
      !EmailValidator.validate(email) ||
      users().some((user) => user.email.toLowerCase() === email.toLowerCase())
    )
      return undefined;
    if (
      props
        .current()
        .some(
          (guest) =>
            composerGuestUser(guest).email.toLowerCase() === email.toLowerCase()
        )
    )
      return undefined;
    return { id: emailToId(email), email, name: email };
  };
  const toggle = (
    user: ReturnType<typeof composerGuestUser>,
    custom = false
  ) => {
    if (disabled()) return;
    const ids = new Set(selection.selectedIds());
    if (ids.has(user.id)) ids.delete(user.id);
    else {
      selection.pick(user, custom);
      ids.add(user.id);
    }
    selection.commit(ids);
  };
  const done = () => {
    if (!disabled()) props.onAddedChange(draft());
    menus.close();
  };
  return (
    <PhoneMenuPage title={t('mobile.people')} done={done}>
      <Input
        variant="value"
        aria-label={t('calendar.addGuests')}
        placeholder={t('common.search')}
        value={search()}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <div class="flex flex-wrap gap-2">
        <For each={[...props.current(), ...draft()]}>
          {(guest) => (
            <span class="inline-flex max-w-full items-center gap-1 rounded-full bg-control pl-2 text-sm">
              <span class="truncate">{composerGuestName(guest)}</span>
              <Show
                when={changes.canRemove(guest)}
                fallback={<span class="w-2" />}
              >
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label={t('calendar.removeGuest', {
                    name: composerGuestName(guest),
                  })}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => changes.remove(guest)}
                >
                  <CloseIcon class="size-4" />
                </Button>
              </Show>
            </span>
          )}
        </For>
      </div>
      <For each={users()}>
        {(user) => (
          <PhoneMenuChoice
            label={user.name || user.email}
            status={<BusyIndicator busy={busyIds().has(user.id)} />}
            detail={user.email}
            icon={
              <span class="size-7 shrink-0">
                <UserIcon
                  id={user.id}
                  name={user.name}
                  size="fill"
                  suppressClick
                  showTooltip={false}
                />
              </span>
            }
            selected={selection.selectedIds().has(user.id)}
            onChoose={() => toggle(user)}
          />
        )}
      </For>
      <Show when={custom()}>
        {(user) => (
          <PhoneMenuChoice
            label={t('calendar.inviteGuest', { email: user().email })}
            onChoose={() => toggle(user(), true)}
          />
        )}
      </Show>
      <Show when={source.isLoading()}>
        <p role="status">{t('common.loadingOptions')}</p>
      </Show>
      <Show when={source.error()}>
        <p role="status">{t('common.optionsUnavailable')}</p>
      </Show>
      <Show when={source.hasMore()}>
        <Button
          variant="ghost"
          size="sheet-row"
          onClick={source.loadMore}
          disabled={source.isLoadingMore()}
        >
          {t('calendar.moreOptions')}
        </Button>
      </Show>
    </PhoneMenuPage>
  );
}
