import { t } from '@app/lib/i18n';
import { Button, RadioGroup, Tabs, TextField } from '@ui';
import { createSignal, For, Match, Switch } from 'solid-js';
import type { Adoption } from '../core/lifecycle';
import {
  type AdoptedSignature,
  SIGNATURE_STYLES,
  type SignatureStyle,
} from '../core/packet';
import { initialsOf } from './format';
import { SignatureMark } from './signature-mark';
import { SignaturePad } from './signature-pad';

const MODES = ['draw', 'type', 'upload'] as const;
type Mode = (typeof MODES)[number];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * The step where a signer chooses how their signature looks: drawn, typed in
 * a cursive face, or an uploaded image. Their initials follow the same face.
 */
export function AdoptSignature(props: {
  name: string;
  onAdopt: (adoption: Adoption) => void;
}) {
  const [mode, setMode] = createSignal<Mode>('type');
  const [name, setName] = createSignal(props.name);
  const [style, setStyle] = createSignal<SignatureStyle>('script-1');
  const [drawing, setDrawing] = createSignal<string>();
  const [upload, setUpload] = createSignal<string>();

  const signature = (): AdoptedSignature | undefined => {
    const typed = name().trim();
    if (mode() === 'type') {
      return typed ? { kind: 'typed', text: typed, style: style() } : undefined;
    }

    const dataUrl = mode() === 'draw' ? drawing() : upload();
    if (!dataUrl) return undefined;
    return mode() === 'draw'
      ? { kind: 'drawn', dataUrl }
      : { kind: 'image', dataUrl };
  };

  function adopt() {
    const chosen = signature();
    if (!chosen) return;
    props.onAdopt({
      signature: chosen,
      initials: {
        kind: 'typed',
        text: initialsOf(name().trim() || props.name),
        style: style(),
      },
    });
  }

  async function chooseImage(file: File | undefined) {
    if (!file) return;
    setUpload(await readAsDataUrl(file));
  }

  return (
    <div class="flex flex-col gap-4">
      <Tabs
        aria-label={t('contracts.signatureMethod')}
        fullWidth
        options={[
          { value: 'draw', label: t('contracts.methodDraw') },
          { value: 'type', label: t('contracts.methodType') },
          { value: 'upload', label: t('contracts.methodUpload') },
        ]}
        value={mode()}
        onChange={setMode}
      />

      <Switch>
        <Match when={mode() === 'draw'}>
          <SignaturePad onChange={setDrawing} />
        </Match>

        <Match when={mode() === 'type'}>
          <TextField value={name()} onChange={setName}>
            <TextField.Label>{t('contracts.fullName')}</TextField.Label>
            <TextField.Input autocomplete="name" />
          </TextField>
          <RadioGroup
            value={style()}
            onChange={(value) => {
              const next = SIGNATURE_STYLES.find((each) => each === value);
              if (next) setStyle(next);
            }}
            aria-label={t('contracts.signatureStyle')}
            class="flex flex-col gap-2"
          >
            <For each={SIGNATURE_STYLES}>
              {(option) => (
                <RadioGroup.Item
                  value={option}
                  class="flex min-h-14 items-center gap-3 rounded-xl border border-edge px-4 data-[checked]:border-ink"
                >
                  <RadioGroup.ItemControl />
                  <RadioGroup.ItemLabel class="h-10 min-w-0 flex-1">
                    <SignatureMark
                      mark={{
                        kind: 'typed',
                        text: name().trim() || props.name,
                        style: option,
                      }}
                      label={t('contracts.signatureStyleOption', {
                        name: name().trim() || props.name,
                      })}
                    />
                  </RadioGroup.ItemLabel>
                </RadioGroup.Item>
              )}
            </For>
          </RadioGroup>
        </Match>

        <Match when={mode() === 'upload'}>
          <label class="flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge p-4 text-center text-sm text-ink-muted">
            <Switch>
              <Match when={upload()}>
                {(dataUrl) => (
                  <img
                    src={dataUrl()}
                    alt={t('contracts.uploadedSignature')}
                    class="max-h-24 max-w-full object-contain"
                  />
                )}
              </Match>
              <Match when={true}>
                <span>{t('contracts.uploadHint')}</span>
              </Match>
            </Switch>
            <input
              type="file"
              accept="image/png,image/jpeg"
              class="max-w-full text-xs"
              aria-label={t('contracts.uploadSignatureImage')}
              onChange={(event) => chooseImage(event.currentTarget.files?.[0])}
            />
          </label>
        </Match>
      </Switch>

      <p class="text-xs text-ink-muted">{t('contracts.adoptNotice')}</p>
      <Button
        variant="primary"
        size="xl"
        fullWidth
        disabled={!signature()}
        onClick={adopt}
      >
        {t('contracts.adoptAndSign')}
      </Button>
    </div>
  );
}
