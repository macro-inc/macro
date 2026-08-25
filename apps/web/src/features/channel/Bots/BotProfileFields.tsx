import UploadIcon from '@phosphor/upload-simple.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { BotAvatar } from './BotAvatar';
import type { BotFormErrors, BotFormValues } from './botForm';

export function BotProfileFields(props: {
  value: BotFormValues;
  errors: BotFormErrors;
  uploadingAvatar: boolean;
  onUploadAvatar: () => void;
  onNameChange: (value: string) => void;
  onHandleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
}) {
  return (
    <>
      <div class="flex items-center gap-3 border-b border-edge-muted pb-4">
        <button
          type="button"
          aria-label="Upload avatar"
          class="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={props.onUploadAvatar}
        >
          <BotAvatar
            bot={{
              name: props.value.name || 'Bot',
              avatar_url: props.value.avatarUrl || undefined,
            }}
            size="lg"
          />
        </button>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">
            {props.value.avatarUrl ? 'Change avatar' : 'Bot avatar'}
          </div>
          <div class="mt-0.5 text-xs text-ink-muted">
            Optional · square images work best
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.uploadingAvatar}
          onClick={props.onUploadAvatar}
        >
          <UploadIcon />
          {props.uploadingAvatar ? 'Uploading…' : 'Upload'}
        </Button>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-3 mobile:grid-cols-1">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium">Name</span>
          <input
            autofocus
            value={props.value.name}
            placeholder="Release bot"
            class="settings-input w-full"
            aria-invalid={!!props.errors.name}
            onInput={(event) => props.onNameChange(event.currentTarget.value)}
          />
          <Show when={props.errors.name}>
            {(error) => <span class="text-xs text-failure">{error()}</span>}
          </Show>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium">Mention handle</span>
          <div class="flex items-center rounded-md border border-edge-muted bg-transparent px-2 focus-within:border-accent">
            <span class="text-sm text-ink-extra-muted">@</span>
            <input
              value={props.value.handle}
              placeholder="release-bot"
              class="min-w-0 flex-1 bg-transparent px-1.5 py-2 text-sm outline-none"
              aria-invalid={!!props.errors.handle}
              onInput={(event) =>
                props.onHandleChange(event.currentTarget.value)
              }
            />
          </div>
          <Show when={props.errors.handle}>
            {(error) => <span class="text-xs text-failure">{error()}</span>}
          </Show>
        </label>
      </div>

      <label class="mt-4 flex flex-col gap-1.5">
        <span class="text-xs font-medium">Description</span>
        <textarea
          value={props.value.description}
          placeholder="Posts release updates and deployment status"
          rows={3}
          class="settings-input h-auto min-h-20 w-full resize-none px-3 py-2.5 leading-5"
          onInput={(event) =>
            props.onDescriptionChange(event.currentTarget.value)
          }
        />
      </label>
    </>
  );
}
