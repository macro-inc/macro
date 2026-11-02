import { t } from '@app/lib/i18n';
import { EmojiSelector } from '@core/component/Emoji/EmojiSelector';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import { EntityIcon } from '@core/component/EntityIcon';
import { Button, Input, Tabs } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  APPEARANCE_COLORS,
  appearanceColor,
  type EntityAppearance,
} from '../core/appearance';
import { ENTITY_ICON_NAMES } from '../core/catalog.generated';

export function AppearancePicker(props: {
  appearance: EntityAppearance;
  defaultIcon: EntityIconSelector;
  onChange: (appearance: EntityAppearance) => void;
  onApply: () => void;
  onCancel: () => void;
  saving: boolean;
  changed: boolean;
  error?: string;
  columns?: number;
}) {
  const [tab, setTab] = createSignal<'icons' | 'emoji'>(
    props.appearance.icon?.kind === 'emoji' ? 'emoji' : 'icons'
  );
  const [search, setSearch] = createSignal('');
  let keyboardScope: HTMLDivElement | undefined;
  const names = () =>
    ENTITY_ICON_NAMES.filter((name) =>
      name.replaceAll('-', ' ').includes(search().trim().toLowerCase())
    );
  const setIcon = (icon: EntityAppearance['icon']) =>
    props.onChange({ ...props.appearance, icon });
  return (
    <div
      class="flex w-88 max-w-full min-h-0 flex-col gap-3 p-3 text-sm"
      aria-busy={props.saving}
    >
      <div class="flex items-center gap-3">
        <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-hover text-2xl">
          <EntityIcon
            targetType={props.defaultIcon}
            appearance={props.appearance}
            size="lg"
          />
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-medium">{t('appearance.title')}</div>
          <div class="text-xs text-ink-muted">{t('appearance.shared')}</div>
        </div>
      </div>
      <div ref={keyboardScope} class="flex min-h-0 flex-col gap-3">
        <Tabs
          aria-label={t('appearance.source')}
          value={tab()}
          onChange={(value) => {
            setTab(value);
            setSearch('');
          }}
          options={[
            { value: 'icons', label: t('appearance.icons') },
            { value: 'emoji', label: t('appearance.emoji') },
          ]}
          fullWidth
        />
        <Input
          aria-label={t('appearance.search')}
          placeholder={t('appearance.search')}
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
        <div
          class="h-56 min-h-32 overflow-auto overscroll-contain"
          data-icon-motion="none"
        >
          <Show
            when={tab() === 'icons'}
            fallback={
              <EmojiSelector
                nameFilter={search()}
                columns={props.columns ?? 7}
                keyboardScope={keyboardScope}
                onEmojiClick={(emoji) =>
                  setIcon({ kind: 'emoji', value: emoji.emoji })
                }
              />
            }
          >
            <div
              class="grid gap-1"
              style={{
                'grid-template-columns': `repeat(${props.columns ?? 7}, minmax(0, 1fr))`,
              }}
            >
              <For each={names()}>
                {(name) => (
                  <Button
                    variant="ghost"
                    size="icon-md"
                    aria-label={name.replaceAll('-', ' ')}
                    aria-pressed={
                      props.appearance.icon?.kind === 'macro' &&
                      props.appearance.icon.name === name
                    }
                    tooltip={name.replaceAll('-', ' ')}
                    onClick={() => setIcon({ kind: 'macro', name })}
                  >
                    <EntityIcon
                      targetType={props.defaultIcon}
                      appearance={{
                        ...props.appearance,
                        icon: { kind: 'macro', name },
                      }}
                      size="sm"
                    />
                  </Button>
                )}
              </For>
            </div>
            <Show when={names().length === 0}>
              <p class="p-4 text-center text-ink-muted">
                {t('appearance.noIcons')}
              </p>
            </Show>
          </Show>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={() => setIcon(null)}>
        {t('appearance.defaultIcon')}
      </Button>
      <Show when={tab() === 'icons'}>
        <fieldset
          class="flex flex-col gap-2"
          disabled={props.appearance.icon?.kind === 'emoji'}
        >
          <legend class="mb-2 text-xs text-ink-muted">
            {t('appearance.color')}
          </legend>
          <div class="flex flex-wrap">
            <For each={APPEARANCE_COLORS}>
              {(color) => (
                <Button
                  variant="ghost"
                  size="icon-md"
                  aria-label={t(`appearance.${color}`)}
                  aria-pressed={props.appearance.color === color}
                  tooltip={t(`appearance.${color}`)}
                  onClick={() => props.onChange({ ...props.appearance, color })}
                >
                  <span
                    class="size-4 rounded-full"
                    classList={{
                      'ring-2 ring-ink ring-offset-2 ring-offset-page':
                        props.appearance.color === color,
                    }}
                    style={{ background: appearanceColor(color) }}
                  />
                </Button>
              )}
            </For>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => props.onChange({ ...props.appearance, color: null })}
          >
            {t('appearance.defaultColor')}
          </Button>
        </fieldset>
      </Show>
      <Show when={props.appearance.icon?.kind === 'emoji'}>
        <p class="text-xs text-ink-muted">{t('appearance.emojiColor')}</p>
      </Show>
      <Show when={props.error}>
        <p role="alert" class="text-xs text-failure">
          {props.error}
        </p>
      </Show>
      <div class="flex items-center gap-2 border-t border-edge-muted pt-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={props.saving}
          onClick={() => props.onChange({ icon: null, color: null })}
        >
          {t('appearance.reset')}
        </Button>
        <div class="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          disabled={props.saving}
          onClick={props.onCancel}
        >
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={props.saving || !props.changed}
          onClick={props.onApply}
        >
          {props.saving ? t('appearance.saving') : t('appearance.apply')}
        </Button>
      </div>
    </div>
  );
}
