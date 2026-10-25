import { ListHeader } from '@app/components/view-shell/ListHeader';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button, Tabs } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import type { PublicProfile } from '../core/types';
import { Field, TextArea, TextInput } from './fields';
import {
  PublicBookingBrand,
  PublicBookingLayout,
} from './public-booking-layout';
import { PublicBookingProfile } from './public-booking-profile';

export function BookingPageEditor(props: {
  headerTitle?: JSX.Element;
  shareAction?: JSX.Element;
  profile: PublicProfile;
  canEdit: boolean;
  saving: boolean;
  hasChanges: boolean;
  onName: (name: string) => void;
  onDescription: (description: string) => void;
  onSave: () => void;
  onRevert: () => void;
}) {
  const [mode, setMode] = createSignal<'edit' | 'preview'>('edit');
  const modeTabs = () => (
    <div class="pointer-events-auto rounded-full touch:bg-panel">
      <Tabs
        aria-label="Booking page mode"
        options={[
          { value: 'edit', label: 'Edit' },
          { value: 'preview', label: 'Preview' },
        ]}
        value={mode()}
        onChange={setMode}
      />
    </div>
  );
  const actions = () => (
    <>
      <Show when={mode() === 'edit'}>
        <div class="pointer-events-auto flex items-center gap-2 touch:rounded-lg touch:bg-panel">
          <HeaderActionGroup label="Booking page changes">
            <Show when={props.canEdit && props.hasChanges}>
              <Button
                type="button"
                variant="ghost"
                aria-label="Revert booking page changes"
                disabled={props.saving}
                onClick={props.onRevert}
              >
                Revert
              </Button>
            </Show>
            <Button
              type="submit"
              variant="strong"
              aria-label={
                props.saving ? 'Saving booking page' : 'Save booking page'
              }
              disabled={!props.canEdit || !props.hasChanges || props.saving}
            >
              {props.saving ? 'Saving…' : 'Save'}
            </Button>
          </HeaderActionGroup>
        </div>
      </Show>
      <Show when={props.shareAction}>
        <HeaderActionGroup label="Sharing">
          {props.shareAction}
        </HeaderActionGroup>
      </Show>
    </>
  );
  return (
    <form
      aria-label="Booking page details"
      aria-busy={props.saving}
      class={
        props.headerTitle
          ? 'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
          : 'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel'
      }
      onSubmit={(event) => {
        event.preventDefault();
        if (
          mode() !== 'edit' ||
          !props.canEdit ||
          props.saving ||
          !props.hasChanges
        )
          return;
        props.onSave();
      }}
    >
      <Show
        when={props.headerTitle}
        fallback={
          <div class="pointer-events-none absolute inset-x-4 top-3 z-10 flex items-center justify-between gap-2">
            {modeTabs()}
            {actions()}
          </div>
        }
      >
        <ListHeader
          title={
            <div class="flex min-w-0 items-center gap-3">
              {props.headerTitle}
              {modeTabs()}
            </div>
          }
        >
          {actions()}
        </ListHeader>
      </Show>
      <Show when={props.hasChanges}>
        <span role="status" class="sr-only">
          Unsaved changes
        </span>
      </Show>
      <section
        aria-label="Booking page preview"
        class={
          props.headerTitle
            ? 'mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel'
            : 'flex min-h-0 flex-1 flex-col'
        }
      >
        <div class="min-h-0 flex-1 overflow-y-auto">
          <PublicBookingLayout
            branding={
              <div class="flex translate-y-7 self-start">
                <PublicBookingBrand target="_blank" />
              </div>
            }
          >
            <Show
              when={mode() === 'edit'}
              fallback={<PublicBookingProfile profile={props.profile} />}
            >
              <PublicBookingProfile
                profile={props.profile}
                heading={
                  <Field label="Display name" labelClass="sr-only" class="mt-3">
                    <TextInput
                      class="h-[1lh] min-h-0 border-0 bg-transparent p-0 text-3xl font-semibold tracking-tight ring-1 ring-edge-frame ring-offset-4 ring-offset-panel @min-[640px]/public-booking:text-4xl"
                      placeholder="Your name or team name"
                      disabled={!props.canEdit || props.saving}
                      value={props.profile.name}
                      onInput={(event) =>
                        props.onName(event.currentTarget.value)
                      }
                    />
                  </Field>
                }
                introduction={
                  <Field label="Introduction" labelClass="sr-only" class="mt-4">
                    <TextArea
                      ref={(element) => {
                        let previousWidth = 0;
                        // Kobalte handles value changes; reflow when width changes too.
                        createResizeObserver(element, ({ width }) => {
                          if (
                            !element.isConnected ||
                            width <= 0 ||
                            width === previousWidth
                          )
                            return;
                          previousWidth = width;
                          element.style.height = 'auto';
                          element.style.height = `${element.scrollHeight}px`;
                        });
                      }}
                      autoResize
                      rows={1}
                      class="min-h-[1lh] overflow-hidden border-0 bg-transparent p-0 text-sm leading-relaxed text-ink-muted ring-1 ring-edge-frame ring-offset-4 ring-offset-panel"
                      placeholder="Add an introduction for your guests"
                      disabled={!props.canEdit || props.saving}
                      value={props.profile.description}
                      onInput={(event) =>
                        props.onDescription(event.currentTarget.value)
                      }
                    />
                  </Field>
                }
              />
            </Show>
          </PublicBookingLayout>
        </div>
      </section>
    </form>
  );
}
