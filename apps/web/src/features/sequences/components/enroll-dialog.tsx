import { t } from '@app/lib/i18n';
import type { EnrollSkip } from '@service-email/generated/schemas';
import { ActionDialogShell, Button, Checkbox, Dialog, Input } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import type { Person } from '../context/sequences-context';
import { SEQUENCE_LIMITS } from '../core/sequence';
import { skipMessage } from './failure-message';

/** People the server skipped, after the rest were enrolled. */
export type EnrollOutcome = {
  enrolled: number;
  skipped: { person: Person; skip: EnrollSkip }[];
};

function PersonLabel(props: { person: Person }) {
  return (
    <span class="ph-no-capture min-w-0 flex-1">
      <span class="block truncate text-sm font-medium">
        {props.person.name || props.person.email || t('sequences.noEmail')}
      </span>
      <span class="block truncate text-xs text-ink-muted">
        {props.person.email}
      </span>
    </span>
  );
}

/**
 * Pick CRM People and a start time. `sequence` is the picker when the
 * dialog chooses the sequence, or its name when it is fixed.
 */
export function EnrollDialog(props: {
  sequence: JSX.Element;
  search: string;
  onSearch: (value: string) => void;
  /** Search results; selected people stay listed first. */
  people: readonly Person[];
  peoplePending: boolean;
  peopleFailed: boolean;
  selected: readonly Person[];
  onSelect: (person: Person, selected: boolean) => void;
  start: string;
  onStart: (value: string) => void;
  consent: boolean;
  onConsent: (value: boolean) => void;
  canEnroll: boolean;
  busy: boolean;
  error?: string;
  outcome?: EnrollOutcome;
  onEnroll: () => void;
  onClose: () => void;
}) {
  const isSelected = (person: Person) =>
    props.selected.some((item) => item.id === person.id);
  const listed = () => [
    ...props.selected,
    ...props.people.filter((person) => !isSelected(person)),
  ];
  const full = () => props.selected.length >= SEQUENCE_LIMITS.contacts;
  return (
    <Dialog
      open
      position="center"
      class="w-[min(620px,calc(100vw-16px))]"
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
      onEscapeKeyDown={(event) => {
        if (props.busy) event.preventDefault();
      }}
    >
      <ActionDialogShell class="max-h-[88vh]">
        <ActionDialogShell.Body class="space-y-4">
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>
              {t('sequences.enrollTitle')}
            </ActionDialogShell.Title>
          </ActionDialogShell.Header>
          <Show
            when={props.outcome}
            fallback={
              <>
                {/* The search comes first, so it takes focus when the dialog opens. */}
                <Input
                  aria-label={t('sequences.searchPeople')}
                  placeholder={t('sequences.searchPeoplePlaceholder')}
                  value={props.search}
                  onInput={(event) => props.onSearch(event.currentTarget.value)}
                />
                {props.sequence}
                <div class="max-h-72 min-h-28 overflow-y-auto rounded-lg border border-edge-muted">
                  <Switch>
                    <Match when={!listed().length && props.peoplePending}>
                      <p class="p-5 text-sm text-ink-muted">
                        {t('sequences.loadingPeople')}
                      </p>
                    </Match>
                    <Match when={!listed().length && props.peopleFailed}>
                      <p class="p-5 text-sm text-failure" role="alert">
                        {t('sequences.peopleLoadFailed')}
                      </p>
                    </Match>
                    <Match when={!listed().length}>
                      <p class="p-5 text-sm text-ink-muted">
                        {t('sequences.noMatchingPeople')}
                      </p>
                    </Match>
                    <Match when={listed().length}>
                      <For each={listed()}>
                        {(person) => (
                          <Checkbox
                            class="flex w-full items-center gap-3 border-b border-edge-muted px-4 py-3 last:border-0"
                            checked={isSelected(person)}
                            disabled={
                              props.busy || (!isSelected(person) && full())
                            }
                            onChange={(checked: boolean) =>
                              props.onSelect(person, checked)
                            }
                          >
                            <Checkbox.Control />
                            <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-3">
                              <PersonLabel person={person} />
                            </Checkbox.Label>
                          </Checkbox>
                        )}
                      </For>
                    </Match>
                  </Switch>
                </div>
                <label class="block space-y-1 text-xs font-medium">
                  {t('sequences.startSending')}
                  <Input
                    type="datetime-local"
                    value={props.start}
                    disabled={props.busy}
                    onInput={(event) =>
                      props.onStart(event.currentTarget.value)
                    }
                  />
                </label>
                <p class="text-xs text-ink-muted">{t('sequences.startHint')}</p>
                <Checkbox
                  class="flex items-start gap-2 text-xs text-ink-muted"
                  checked={props.consent}
                  disabled={props.busy}
                  onChange={(checked: boolean) => props.onConsent(checked)}
                >
                  <Checkbox.Control />
                  <Checkbox.Label>{t('sequences.consent')}</Checkbox.Label>
                </Checkbox>
                <Show when={props.error}>
                  {(error) => (
                    <p class="text-xs text-failure" role="alert">
                      {error()}
                    </p>
                  )}
                </Show>
              </>
            }
          >
            {(outcome) => (
              <div class="space-y-3" role="status">
                <p class="text-sm">
                  {t('sequences.enrolledCount', {
                    count: outcome().enrolled,
                  })}
                </p>
                <p class="text-xs text-ink-muted">
                  {t('sequences.skippedCount', {
                    count: outcome().skipped.length,
                  })}
                </p>
                <ul class="max-h-72 overflow-y-auto rounded-lg border border-edge-muted">
                  <For each={outcome().skipped}>
                    {(item) => (
                      <li class="flex items-center gap-3 border-b border-edge-muted px-4 py-3 last:border-0">
                        <PersonLabel person={item.person} />
                        <span class="shrink-0 text-xs text-ink-muted">
                          {skipMessage(item.skip)}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            )}
          </Show>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer class="items-center">
          <Show
            when={!props.outcome}
            fallback={
              <Button
                type="button"
                variant="primary"
                onClick={() => props.onClose()}
              >
                {t('sequences.done')}
              </Button>
            }
          >
            <span class="mr-auto text-xs text-ink-muted">
              {t('sequences.selectedCount', {
                count: props.selected.length,
                max: SEQUENCE_LIMITS.contacts,
              })}
            </span>
            <Button
              type="button"
              variant="ghost"
              disabled={props.busy}
              onClick={() => props.onClose()}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={
                !props.canEnroll ||
                !props.selected.length ||
                !props.consent ||
                props.busy
              }
              loading={props.busy}
              onClick={() => props.onEnroll()}
            >
              {t('sequences.enrollCount', { count: props.selected.length })}
            </Button>
          </Show>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
