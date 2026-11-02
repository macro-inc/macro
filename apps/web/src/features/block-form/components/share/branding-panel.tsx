import { fireAndForget } from '@core/util/fireAndForget';
import { openFilePicker } from '@core/util/upload';
import { Button, Input } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { useFormContext } from '../../context/form-context';
import type { FormBranding } from '../../core/form-model';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

type BrandingPatch = Partial<FormBranding>;

/**
 * The logo, cover image and accent color the respond page shows, so a form
 * looks like part of its owner's business. Unset parts keep Macro's look.
 */
export function BrandingPanel(props: {
  branding: FormBranding;
  canEdit: boolean;
  pending: boolean;
  onChange: (patch: BrandingPatch, what: string) => Promise<void>;
}) {
  const context = useFormContext();
  const [uploading, setUploading] = createSignal<'logo' | 'cover'>();
  const disabled = () => !props.canEdit || props.pending || !!uploading();

  function upload(part: 'logo' | 'cover') {
    openFilePicker(
      { acceptedMimeTypes: IMAGE_TYPES, multiple: false },
      async ([file]) => {
        if (!file) return;
        setUploading(part);
        const uploaded = await context.branding.uploadImage(file);
        if (uploaded.isErr()) {
          setUploading(undefined);
          context.notify.failure(
            `The image couldn’t be uploaded: ${uploaded.error.message}`
          );
          return;
        }
        await props.onChange(
          part === 'logo'
            ? { logoFileId: uploaded.value }
            : { coverFileId: uploaded.value },
          part === 'logo' ? 'The logo' : 'The cover image'
        );
        setUploading(undefined);
      }
    );
  }

  function changeAccent(value: string) {
    const accentColor = value.trim().toLowerCase();
    if (!HEX_COLOR.test(accentColor)) {
      context.notify.failure('Enter a color like #1f6feb.');
      return;
    }
    if (accentColor !== props.branding.accentColor)
      fireAndForget(
        props.onChange({ accentColor }, 'The accent color'),
        'form-branding'
      );
  }

  return (
    <div class="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-4">
      <div class="flex flex-col gap-0.5">
        <h3 class="text-sm font-semibold text-ink">Branding</h3>
        <p class="text-xs text-ink-muted">
          Shown to everyone who opens the form.
        </p>
      </div>
      <BrandingRow
        label="Logo"
        hint="Above the form’s title."
        preview={
          <Show when={props.branding.logoFileId}>
            {(logo) => (
              <img
                src={context.branding.imageUrl(logo(), 'small')}
                alt="Logo"
                class="size-full object-contain"
              />
            )}
          </Show>
        }
      >
        <ImageActions
          set={!!props.branding.logoFileId}
          uploading={uploading() === 'logo'}
          disabled={disabled()}
          onUpload={() => upload('logo')}
          onRemove={() =>
            fireAndForget(
              props.onChange({ logoFileId: null }, 'The logo'),
              'form-branding'
            )
          }
        />
      </BrandingRow>
      <BrandingRow
        label="Cover image"
        hint="A banner across the top of the page."
        preview={
          <Show when={props.branding.coverFileId}>
            {(cover) => (
              <img
                src={context.branding.imageUrl(cover(), 'small')}
                alt="Cover"
                class="size-full object-cover"
              />
            )}
          </Show>
        }
      >
        <ImageActions
          set={!!props.branding.coverFileId}
          uploading={uploading() === 'cover'}
          disabled={disabled()}
          onUpload={() => upload('cover')}
          onRemove={() =>
            fireAndForget(
              props.onChange({ coverFileId: null }, 'The cover image'),
              'form-branding'
            )
          }
        />
      </BrandingRow>
      <BrandingRow
        label="Accent color"
        hint="Buttons, selections and focus rings."
        preview={
          <input
            type="color"
            aria-label="Pick an accent color"
            value={props.branding.accentColor ?? '#000000'}
            disabled={disabled()}
            class="size-full cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default"
            onChange={(event) => changeAccent(event.currentTarget.value)}
          />
        }
      >
        <Input
          aria-label="Accent color"
          class="w-28"
          value={props.branding.accentColor ?? ''}
          placeholder="Default"
          maxlength={7}
          disabled={disabled()}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value.trim()) changeAccent(value);
          }}
        />
        <Show when={props.branding.accentColor}>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled()}
            onClick={() =>
              fireAndForget(
                props.onChange({ accentColor: null }, 'The accent color'),
                'form-branding'
              )
            }
          >
            Reset
          </Button>
        </Show>
      </BrandingRow>
      <Show when={!props.canEdit}>
        <p class="text-xs text-ink-muted">Only editors can change branding.</p>
      </Show>
    </div>
  );
}

function BrandingRow(props: {
  label: string;
  hint: string;
  preview: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-edge-muted bg-input">
        {props.preview}
      </div>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="text-sm font-medium text-ink">{props.label}</span>
        <span class="text-xs text-ink-muted">{props.hint}</span>
      </div>
      <div class="flex items-center gap-2">{props.children}</div>
    </div>
  );
}

function ImageActions(props: {
  set: boolean;
  uploading: boolean;
  disabled: boolean;
  onUpload: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={props.disabled}
        aria-busy={props.uploading}
        onClick={props.onUpload}
      >
        {props.uploading ? 'Uploading…' : props.set ? 'Replace' : 'Upload'}
      </Button>
      <Show when={props.set}>
        <Button
          variant="ghost"
          size="sm"
          disabled={props.disabled}
          onClick={props.onRemove}
        >
          Remove
        </Button>
      </Show>
    </>
  );
}
