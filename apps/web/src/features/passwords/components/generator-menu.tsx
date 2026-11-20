import { t } from '@app/lib/i18n';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import KeyIcon from '@icon/system/regular/key.svg';
import { Button, Checkbox, Dropdown, Input } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  CHARACTER_CLASSES,
  type CharacterClass,
  generatePassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../core/generator';

const CLASS_NAMES = Object.keys(CHARACTER_CLASSES) as CharacterClass[];

/** Anchored generator: length, character classes, preview, Use. */
export function GeneratorMenu(props: { onUse: (password: string) => void }) {
  const [length, setLength] = createSignal(24);
  const [classes, setClasses] = createSignal<CharacterClass[]>([
    ...CLASS_NAMES,
  ]);
  const clampedLength = () =>
    Math.max(
      MIN_PASSWORD_LENGTH,
      Math.min(MAX_PASSWORD_LENGTH, Math.round(length() || 24))
    );
  const generate = () =>
    classes().length ? generatePassword(clampedLength(), classes()) : '';
  const [value, setValue] = createSignal(generate());
  const regenerate = () => setValue(generate());
  const toggle = (name: CharacterClass, enabled: boolean) => {
    setClasses((current) =>
      enabled
        ? CLASS_NAMES.filter(
            (entry) => entry === name || current.includes(entry)
          )
        : current.filter((entry) => entry !== name)
    );
    regenerate();
  };
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="ghost"
        size="icon-sm"
        aria-label={t('passwords.generator')}
        tooltip={t('passwords.generator')}
      >
        <KeyIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-72 max-w-[calc(100vw-2rem)]">
        <div class="flex flex-col gap-3 p-2">
          <output
            aria-live="polite"
            class="min-h-10 break-all rounded-lg font-mono text-sm text-ink"
          >
            {value()}
          </output>
          <label class="flex items-center justify-between gap-3 text-sm text-ink-muted">
            {t('passwords.length')}
            <Input
              type="number"
              size="sm"
              class="w-20"
              min={MIN_PASSWORD_LENGTH}
              max={MAX_PASSWORD_LENGTH}
              value={length()}
              onInput={(event) => {
                setLength(event.currentTarget.valueAsNumber);
                regenerate();
              }}
            />
          </label>
          <fieldset class="flex flex-wrap gap-x-4 gap-y-2">
            <legend class="mb-1 text-xs text-ink-muted">
              {t('passwords.characterClasses')}
            </legend>
            <For each={CLASS_NAMES}>
              {(name) => (
                <Checkbox
                  checked={classes().includes(name)}
                  onChange={(enabled) => toggle(name, enabled)}
                >
                  <Checkbox.Control />
                  <Checkbox.Label>{t(`passwords.${name}`)}</Checkbox.Label>
                </Checkbox>
              )}
            </For>
          </fieldset>
          <div class="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!classes().length}
              onClick={regenerate}
            >
              <ArrowsClockwiseIcon class="size-4" />
              {t('passwords.generate')}
            </Button>
            <Show when={value()}>
              <Dropdown.Item
                class="justify-center"
                onSelect={() => props.onUse(value())}
              >
                {t('passwords.usePassword')}
              </Dropdown.Item>
            </Show>
          </div>
        </div>
      </Dropdown.Content>
    </Dropdown>
  );
}
