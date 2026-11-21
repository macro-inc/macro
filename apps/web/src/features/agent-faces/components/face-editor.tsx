import { type TranslationKey, t } from '@app/lib/i18n';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import ImageIcon from '@icon/system/regular/image.svg';
import { type FacePart, resolvedParts } from '@macro-inc/agent-faces';
import { Button, Tabs } from '@ui';
import { createMemo, createSignal, For, Index, Show } from 'solid-js';
import {
  FACE_TABS,
  type FacePartRow,
  type FaceTab,
  partsOfTab,
} from '../core/face-tabs';
import type { FaceDraft } from '../primitives/create-face-draft';
import {
  createFaceSuggestions,
  sameFace,
} from '../primitives/create-face-suggestions';
import { FaceImage } from './face-image';

const PREVIEW_SIZE = 32;

const TAB_LABEL: Record<FaceTab, TranslationKey> = {
  head: 'agentFaces.tabHead',
  hair: 'agentFaces.tabHair',
  face: 'agentFaces.tabFace',
  extras: 'agentFaces.tabExtras',
  outfit: 'agentFaces.tabOutfit',
};

const PART_LABEL: Record<FacePart, TranslationKey> = {
  head: 'agentFaces.partHead',
  skin: 'agentFaces.partSkin',
  hair: 'agentFaces.partHair',
  hairColor: 'agentFaces.partHairColor',
  facialHair: 'agentFaces.partFacialHair',
  eyes: 'agentFaces.partEyes',
  brows: 'agentFaces.partBrows',
  nose: 'agentFaces.partNose',
  mouth: 'agentFaces.partMouth',
  cheeks: 'agentFaces.partCheeks',
  glasses: 'agentFaces.partGlasses',
  headwear: 'agentFaces.partHeadwear',
  earrings: 'agentFaces.partEarrings',
  shirt: 'agentFaces.partShirt',
  shirtColor: 'agentFaces.partShirtColor',
  accent: 'agentFaces.partAccent',
  background: 'agentFaces.partBackground',
};

/**
 * Eight suggested faces to pick from (New faces replaces them; the chosen face
 * stays chosen), then the chosen face's parts, a tab at a time: pick an option
 * to pin it, Reset to unpin everything, or a photo instead.
 * While a photo is chosen it offers to replace it or go back to the face.
 */
export function FaceEditor(props: {
  draft: FaceDraft;
  initials: string;
  /** Stretch the tabs across the editor, for a phone sheet. */
  fullWidthTabs?: boolean;
}) {
  const [tab, setTab] = createSignal<FaceTab>('head');
  const suggestions = createFaceSuggestions();
  let picker: HTMLInputElement | undefined;

  return (
    <div data-face-editor>
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        class="hidden"
        data-face-photo-input
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) props.draft.setPhoto(file);
        }}
      />
      <Show
        when={props.draft.photo()}
        fallback={
          <div class="flex flex-col gap-3">
            <div class="flex flex-col gap-1.5" data-face-suggestions>
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs text-ink-muted">
                  {t('agentFaces.suggestions')}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => suggestions.regenerate()}
                >
                  <ArrowsClockwiseIcon class="size-4" />
                  {t('agentFaces.newFaces')}
                </Button>
              </div>
              {/* Auto columns spread edge to edge, so the first and last
                  faces line up with the labels on every width. */}
              <div class="grid grid-cols-[repeat(8,auto)] justify-between gap-y-2 max-sm:grid-cols-[repeat(4,auto)] max-sm:gap-y-4">
                <Index each={suggestions.faces()}>
                  {(face, index) => (
                    <button
                      type="button"
                      aria-label={t('agentFaces.suggestion', {
                        number: index + 1,
                      })}
                      aria-pressed={sameFace(face(), props.draft.face())}
                      class="group flex items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-edge-focus touch:min-h-[44px] touch:min-w-[44px]"
                      onClick={() => props.draft.choose(face())}
                    >
                      <span class="block size-9 rounded-full outline-2 outline-offset-1 outline-transparent group-aria-pressed:outline-ink touch:size-12">
                        <FaceImage
                          face={face()}
                          size="fill"
                          initials={props.initials}
                        />
                      </span>
                    </button>
                  )}
                </Index>
              </div>
            </div>
            <Tabs
              aria-label={t('agentFaces.part')}
              size="sm"
              touch="segmented"
              fullWidth={props.fullWidthTabs}
              options={FACE_TABS.map((value) => ({
                value,
                label: t(TAB_LABEL[value]),
              }))}
              value={tab()}
              onChange={setTab}
            />
            <div class="flex flex-col gap-3">
              <For each={partsOfTab(tab())}>
                {(row) => (
                  <PartRow
                    row={row}
                    draft={props.draft}
                    initials={props.initials}
                  />
                )}
              </For>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => picker?.click()}
              >
                <ImageIcon class="size-4" />
                {t('agentFaces.uploadPhoto')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={Object.keys(props.draft.face().pins).length === 0}
                onClick={() => props.draft.reset()}
              >
                {t('agentFaces.reset')}
              </Button>
            </div>
          </div>
        }
      >
        {(photo) => (
          <div class="flex flex-col items-center gap-3 py-2">
            <FaceImage
              face={props.draft.face()}
              photoUrl={photo().url}
              size={96}
              initials={props.initials}
            />
            <div class="flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => picker?.click()}
              >
                <ImageIcon class="size-4" />
                {t('agentFaces.replacePhoto')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => props.draft.setPhoto(undefined)}
              >
                {t('agentFaces.useGeneratedFace')}
              </Button>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

/** One part's options: colour swatches, or the face drawn with each option. */
function PartRow(props: {
  row: FacePartRow;
  draft: FaceDraft;
  initials: string;
}) {
  const current = createMemo(
    () => resolvedParts(props.draft.face())[props.row.part]
  );
  const pinned = () => props.draft.face().pins[props.row.part];
  const label = () => t(PART_LABEL[props.row.part]);
  const options = () =>
    Array.from({ length: props.row.options }, (_, index) => index);

  return (
    <div class="flex flex-col gap-1.5" data-face-part={props.row.part}>
      <span class="text-xs text-ink-muted">{label()}</span>
      {/* Each button is the hit area; the ring sits on what it draws, so a
          44px touch target doesn't ring a 24px swatch. */}
      <div class="flex flex-wrap gap-1.5 touch:gap-y-2">
        <button
          type="button"
          aria-label={t('agentFaces.anyPart', { part: label() })}
          aria-pressed={pinned() === undefined}
          class="group flex items-center rounded-full focus-visible:ring-2 focus-visible:ring-edge-focus touch:min-h-[44px]"
          onClick={() => props.draft.unpin(props.row.part)}
        >
          <span class="rounded-full border border-edge-muted px-2 py-0.5 dark-mode:border-edge text-xs text-ink-muted outline-2 outline-offset-1 outline-transparent group-aria-pressed:outline-ink">
            {t('agentFaces.any')}
          </span>
        </button>
        <Index each={options()}>
          {(index) => (
            <button
              type="button"
              aria-label={t('agentFaces.option', {
                part: label(),
                number: index() + 1,
              })}
              aria-pressed={pinned() === index()}
              class="flex items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-edge-focus touch:min-h-[44px] touch:min-w-[44px]"
              onClick={() => props.draft.pin(props.row.part, index())}
            >
              {/* A pin gets the ink ring; while "Any" holds it, the option
                  the face resolves to only gets a quiet one. */}
              <span
                class="block rounded-full outline-2 outline-offset-1"
                classList={{
                  'outline-ink': pinned() === index(),
                  'outline-edge-muted dark-mode:outline-ink-muted':
                    pinned() === undefined && current() === index(),
                  'outline-transparent': current() !== index(),
                }}
              >
                <Show
                  when={props.row.swatches?.[index()]}
                  fallback={
                    <FaceImage
                      face={{
                        ...props.draft.face(),
                        pins: {
                          ...props.draft.face().pins,
                          [props.row.part]: index(),
                        },
                      }}
                      size={PREVIEW_SIZE}
                      initials={props.initials}
                    />
                  }
                >
                  {(hex) => (
                    <span
                      class="block size-6 rounded-full border border-edge-muted"
                      style={{ background: hex() }}
                    />
                  )}
                </Show>
              </span>
            </button>
          )}
        </Index>
      </div>
    </div>
  );
}
