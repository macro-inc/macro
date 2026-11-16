import { formatLocale, t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import StarFillIcon from '@icon/system/fill/star-fill.svg';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import StarIcon from '@icon/system/regular/star.svg';
import { Button, Dropdown, Input } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { PasswordFailure } from '../context/passwords-context';
import { KIND_LAYOUTS, type PasswordSlotLabel } from '../core/kinds';
import type {
  PasswordActivity,
  PasswordItem,
  PasswordValues,
  PasswordVersion,
} from '../core/types';

const MASK = '••••••••••••';

function IconAction(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: JSX.Element;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={props.label}
      tooltip={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

/** One labeled value with its actions on the same row. */
export function FieldRow(props: {
  label: string;
  children: JSX.Element;
  actions?: JSX.Element;
}) {
  return (
    <div class="flex min-w-0 items-center gap-2 border-b border-edge-muted py-2.5">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-xs text-ink-muted">{props.label}</span>
        <div class="min-w-0 break-words text-sm text-ink">{props.children}</div>
      </div>
      <div class="flex shrink-0 items-center gap-0.5">{props.actions}</div>
    </div>
  );
}

/** Seconds left in the current verification-code period, as a small ring. */
function CodeCountdown(props: { seconds: number; period: number }) {
  const circumference = 2 * Math.PI * 7;
  return (
    <span class="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <svg viewBox="0 0 18 18" class="size-4 -rotate-90" aria-hidden="true">
        <circle
          cx="9"
          cy="9"
          r="7"
          fill="none"
          class="stroke-edge-muted"
          stroke-width="2"
        />
        <circle
          cx="9"
          cy="9"
          r="7"
          fill="none"
          class="stroke-accent"
          stroke-width="2"
          stroke-dasharray={`${circumference}`}
          stroke-dashoffset={`${circumference * (1 - props.seconds / props.period)}`}
        />
      </svg>
      {t('passwords.seconds', { count: props.seconds })}
    </span>
  );
}

export type ItemDetailState = {
  username: string | undefined;
  usernameLoading: boolean;
  usernameCopied: boolean;
  values: PasswordValues | undefined;
  copied: boolean;
  code: { code: string; validUntil: string; period: number } | undefined;
  codeFailed: boolean;
  failure: PasswordFailure | undefined;
  history: PasswordVersion[];
  activity: PasswordActivity[];
  now: number;
};

export type ItemDetailActions = {
  reveal: (version?: number) => void;
  conceal: () => void;
  copyPassword: () => void;
  copyUsername: () => void;
  copyValue: (value: string) => Promise<boolean>;
  loadCode: () => void;
  setTotp: (key: string) => Promise<boolean | undefined>;
  loadHistory: () => void;
};

/** Read view of an item; secret values stay masked until revealed. */
export function ItemDetailBody(props: {
  item: PasswordItem;
  state: ItemDetailState;
  actions: ItemDetailActions;
}) {
  const layout = () => KIND_LAYOUTS[props.item.kind];
  const label = (name: PasswordSlotLabel) => t(`passwords.slot_${name}`);
  const [copiedField, setCopiedField] = createSignal<string>();
  const [seed, setSeed] = createSignal('');
  const [addingTotp, setAddingTotp] = createSignal(false);
  async function enroll() {
    if (await props.actions.setTotp(seed().trim())) {
      setSeed('');
      setAddingTotp(false);
    }
  }
  async function copyAndMark(key: string, value: string) {
    if (await props.actions.copyValue(value)) setCopiedField(key);
  }
  const copyField = (key: string, value: string) =>
    fireAndForget(copyAndMark(key, value), 'passwords-copy');
  const secondsLeft = () => {
    const code = props.state.code;
    if (!code) return 0;
    return Math.max(
      0,
      Math.ceil((Date.parse(code.validUntil) - props.state.now) / 1000)
    );
  };
  const date = (value: string) =>
    new Intl.DateTimeFormat(formatLocale(), {
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));
  return (
    <div class="flex flex-col">
      <For each={layout().slots}>
        {(entry) => (
          <>
            <Show when={entry.slot === 'username'}>
              <FieldRow
                label={label(entry.label)}
                actions={
                  <IconAction
                    label={
                      props.state.usernameCopied
                        ? t('passwords.copied')
                        : t('passwords.copyValue', {
                            label: label(entry.label),
                          })
                    }
                    disabled={!props.state.username}
                    onClick={props.actions.copyUsername}
                  >
                    <Show
                      when={props.state.usernameCopied}
                      fallback={<CopyIcon class="size-4" />}
                    >
                      <CheckIcon class="size-4" />
                    </Show>
                  </IconAction>
                }
              >
                <Show
                  when={props.state.username !== undefined}
                  fallback={
                    <span class="text-ink-muted">
                      {props.state.usernameLoading
                        ? t('passwords.loadingUsername')
                        : t('passwords.usernameUnavailable')}
                    </span>
                  }
                >
                  {props.state.username || (
                    <span class="text-ink-muted">—</span>
                  )}
                </Show>
              </FieldRow>
            </Show>
            <Show when={entry.slot === 'password'}>
              <FieldRow
                label={label(entry.label)}
                actions={
                  <>
                    <IconAction
                      label={
                        props.state.values
                          ? t('passwords.hideValue', {
                              label: label(entry.label),
                            })
                          : t('passwords.revealValue', {
                              label: label(entry.label),
                            })
                      }
                      onClick={() =>
                        props.state.values
                          ? props.actions.conceal()
                          : props.actions.reveal()
                      }
                    >
                      <Show
                        when={props.state.values}
                        fallback={<EyeIcon class="size-4" />}
                      >
                        <EyeSlashIcon class="size-4" />
                      </Show>
                    </IconAction>
                    <IconAction
                      label={
                        props.state.copied
                          ? t('passwords.copied')
                          : t('passwords.copyValue', {
                              label: label(entry.label),
                            })
                      }
                      onClick={props.actions.copyPassword}
                    >
                      <Show
                        when={props.state.copied}
                        fallback={<CopyIcon class="size-4" />}
                      >
                        <CheckIcon class="size-4" />
                      </Show>
                    </IconAction>
                  </>
                }
              >
                <span class="break-all font-mono">
                  {props.state.values?.password ?? MASK}
                </span>
              </FieldRow>
            </Show>
            <Show when={entry.slot === 'url' && props.item.url}>
              {(url) => (
                <FieldRow
                  label={label(entry.label)}
                  actions={
                    <>
                      <IconAction
                        label={t('passwords.openWebsite')}
                        onClick={() => openExternalUrl(url())}
                      >
                        <ArrowSquareOutIcon class="size-4" />
                      </IconAction>
                      <IconAction
                        label={
                          copiedField() === 'url'
                            ? t('passwords.copied')
                            : t('passwords.copyValue', {
                                label: label(entry.label),
                              })
                        }
                        onClick={() => copyField('url', url())}
                      >
                        <Show
                          when={copiedField() === 'url'}
                          fallback={<CopyIcon class="size-4" />}
                        >
                          <CheckIcon class="size-4" />
                        </Show>
                      </IconAction>
                    </>
                  }
                >
                  <span class="break-all">{url()}</span>
                </FieldRow>
              )}
            </Show>
            <Show when={entry.slot === 'notes'}>
              <FieldRow
                label={label(entry.label)}
                actions={
                  <>
                    <Show
                      when={
                        !layout().slots.some((slot) => slot.slot === 'password')
                      }
                    >
                      <IconAction
                        label={
                          props.state.values
                            ? t('passwords.hideValue', {
                                label: label(entry.label),
                              })
                            : t('passwords.revealValue', {
                                label: label(entry.label),
                              })
                        }
                        onClick={() =>
                          props.state.values
                            ? props.actions.conceal()
                            : props.actions.reveal()
                        }
                      >
                        <Show
                          when={props.state.values}
                          fallback={<EyeIcon class="size-4" />}
                        >
                          <EyeSlashIcon class="size-4" />
                        </Show>
                      </IconAction>
                    </Show>
                    <Show when={props.state.values?.notes}>
                      {(notes) => (
                        <IconAction
                          label={t('passwords.copyValue', {
                            label: label(entry.label),
                          })}
                          onClick={() => copyField('notes', notes())}
                        >
                          <Show
                            when={copiedField() === 'notes'}
                            fallback={<CopyIcon class="size-4" />}
                          >
                            <CheckIcon class="size-4" />
                          </Show>
                        </IconAction>
                      )}
                    </Show>
                  </>
                }
              >
                <span class="whitespace-pre-wrap">
                  {props.state.values ? props.state.values.notes || '—' : MASK}
                </span>
              </FieldRow>
            </Show>
          </>
        )}
      </For>
      <For each={props.state.values?.fields ?? []}>
        {(field, index) => (
          <FieldRow
            label={field.label}
            actions={
              <IconAction
                label={t('passwords.copyValue', { label: field.label })}
                onClick={() => copyField(`field:${index()}`, field.value)}
              >
                <Show
                  when={copiedField() === `field:${index()}`}
                  fallback={<CopyIcon class="size-4" />}
                >
                  <CheckIcon class="size-4" />
                </Show>
              </IconAction>
            }
          >
            <span class="whitespace-pre-wrap break-words">
              {field.value || '—'}
            </span>
          </FieldRow>
        )}
      </For>
      <Show when={props.item.hasTotp}>
        <FieldRow
          label={t('passwords.totp')}
          actions={
            <Show
              when={props.state.code}
              fallback={
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={props.actions.loadCode}
                  >
                    {props.state.codeFailed
                      ? t('passwords.retry')
                      : t('passwords.loadCode')}
                  </Button>
                </>
              }
            >
              {(code) => (
                <IconAction
                  label={t('passwords.copyValue', {
                    label: t('passwords.totp'),
                  })}
                  onClick={() => copyField('totp', code().code)}
                >
                  <Show
                    when={copiedField() === 'totp'}
                    fallback={<CopyIcon class="size-4" />}
                  >
                    <CheckIcon class="size-4" />
                  </Show>
                </IconAction>
              )}
            </Show>
          }
        >
          <Show
            when={props.state.code}
            fallback={
              <span class="text-ink-muted">
                {props.state.codeFailed ? t('passwords.codeFailed') : MASK}
              </span>
            }
          >
            {(code) => (
              <span class="flex items-center gap-3">
                <output class="font-mono text-xl tracking-[0.2em]">
                  {code().code.replace(/^(\d{3})(\d{3})$/, '$1 $2')}
                </output>
                <CodeCountdown seconds={secondsLeft()} period={code().period} />
              </span>
            )}
          </Show>
        </FieldRow>
      </Show>
      <Show
        when={
          props.item.canEdit && !props.item.hasTotp && layout().totp !== 'none'
        }
      >
        <Show
          when={addingTotp() || layout().totp === 'required'}
          fallback={
            <div class="py-2.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAddingTotp(true)}
              >
                {t('passwords.addTotp')}
              </Button>
            </div>
          }
        >
          <form
            class="flex items-center gap-2 border-b border-edge-muted py-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (seed().trim()) fireAndForget(enroll(), 'passwords-totp');
            }}
          >
            <Input
              type="password"
              autocomplete="off"
              spellcheck={false}
              class="min-w-0 flex-1"
              aria-label={t('passwords.totpKey')}
              placeholder={t('passwords.totpSeed')}
              value={seed()}
              onInput={(event) => setSeed(event.currentTarget.value)}
            />
            <Button type="submit" variant="secondary" size="sm">
              {t('passwords.save')}
            </Button>
          </form>
        </Show>
      </Show>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-xs text-ink-muted">
        <Show when={props.item.lastUsedAt}>
          {(used) => (
            <span>{t('passwords.lastUsedOn', { date: date(used()) })}</span>
          )}
        </Show>
        <span>
          {t('passwords.updatedOn', { date: date(props.item.updatedAt) })}
        </span>
        <span>
          {t('passwords.createdOn', { date: date(props.item.createdAt) })}
        </span>
        <Show when={layout().slots.some((slot) => slot.slot === 'password')}>
          <Dropdown
            onOpenChange={(open) => {
              if (open) props.actions.loadHistory();
            }}
          >
            <Dropdown.Trigger variant="ghost" size="xs">
              {t('passwords.history')}
            </Dropdown.Trigger>
            <Dropdown.Content class="min-w-56 max-w-[calc(100vw-2rem)]">
              <For each={props.state.history}>
                {(version) => (
                  <Dropdown.Item
                    onSelect={() => props.actions.reveal(version.version)}
                  >
                    <span class="truncate">
                      {t('passwords.version', { version: version.version })} ·{' '}
                      {date(version.createdAt)}
                    </span>
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Content>
          </Dropdown>
        </Show>
      </div>
      <For each={props.state.activity}>
        {(activity) => (
          <p class="py-1 text-xs text-ink-muted">
            {t(`passwords.event_${activity.action}`)} ·{' '}
            {new Intl.DateTimeFormat(formatLocale(), {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(activity.occurredAt))}
          </p>
        )}
      </For>
    </div>
  );
}

export function FavoriteToggle(props: {
  favorite: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={props.favorite}
      aria-label={
        props.favorite ? t('passwords.unfavorite') : t('passwords.addFavorite')
      }
      tooltip={
        props.favorite ? t('passwords.unfavorite') : t('passwords.addFavorite')
      }
      onClick={props.onToggle}
    >
      <Show when={props.favorite} fallback={<StarIcon class="size-4" />}>
        <StarFillIcon class="size-4 text-warning" />
      </Show>
    </Button>
  );
}
