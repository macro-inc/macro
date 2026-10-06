/**
 * Insert ▸ Link (PowerPoint's Insert Hyperlink dialog): link text, cells,
 * or shapes to a web page, to a place in this presentation (a slide, or
 * the first, last, next, or previous one), or to an e-mail address, with
 * the text to display and a ScreenTip.
 */

import type { DeckOutline } from '@core/pptx-engine/types';
import At from '@phosphor/at.svg';
import Globe from '@phosphor/globe.svg';
import Presentation from '@phosphor/presentation.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Input } from '@ui/components/Input';
import {
  createResource,
  createSignal,
  For,
  type JSX,
  onMount,
  Show,
} from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import {
  emailLink,
  JUMPS,
  type LinkKind,
  linkKind,
  normalizeAddress,
  parseEmail,
  slideLinkId,
  slideTitle,
} from '../core/links';
import type { LinkTarget } from '../primitives/create-editor-commands';
import { BitmapCanvas } from './bitmap-canvas';

const PREVIEW_WIDTH = 176;

const TABS: { kind: LinkKind; label: string; icon: JSX.Element }[] = [
  { kind: 'web', label: 'Web Page or File', icon: <Globe /> },
  { kind: 'place', label: 'Place in This Document', icon: <Presentation /> },
  { kind: 'email', label: 'E-mail Address', icon: <At /> },
];

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <label class="flex flex-col gap-1 text-ink-muted text-xs">
      {props.label}
      {props.children}
    </label>
  );
}

function SlidePreview(props: {
  engine: PresentationEngine;
  deck: DeckOutline;
  index: number;
}) {
  const height = () => (PREVIEW_WIDTH * props.deck.height) / props.deck.width;
  const [bitmap] = createResource(
    () => props.index,
    (index) =>
      props.engine.render(
        index,
        Math.round(PREVIEW_WIDTH * (window.devicePixelRatio || 1))
      )
  );
  return (
    <BitmapCanvas
      class="rounded-sm border border-edge-muted bg-page"
      style={{ width: `${PREVIEW_WIDTH}px`, height: `${height()}px` }}
      bitmap={bitmap.latest}
      width={PREVIEW_WIDTH * (window.devicePixelRatio || 1)}
      height={height() * (window.devicePixelRatio || 1)}
      data-testid="pptx-link-preview"
    />
  );
}

export function LinkDialog(props: {
  engine: PresentationEngine;
  deck: DeckOutline;
  /** The slide being edited (relative jumps are previewed from it). */
  current: number;
  target: LinkTarget;
  onApply: (link: string, tip: string, text?: string) => void;
  onClose: () => void;
}) {
  const initial = props.target.link ?? '';
  const email = linkKind(initial) === 'email' ? parseEmail(initial) : undefined;
  const [kind, setKind] = createSignal<LinkKind>(linkKind(initial));
  const [text, setText] = createSignal(props.target.text ?? '');
  const [tip, setTip] = createSignal(props.target.tip ?? '');
  const [address, setAddress] = createSignal(
    linkKind(initial) === 'web' ? initial : ''
  );
  const [place, setPlace] = createSignal(
    linkKind(initial) === 'place' ? initial : '#nextslide'
  );
  const [mail, setMail] = createSignal(email?.address ?? '');
  const [subject, setSubject] = createSignal(email?.subject ?? '');
  const editing = !!props.target.link;
  // Typing into "Text to display" stops the address from filling it in.
  let textTouched = !!props.target.text;

  const link = () =>
    kind() === 'web'
      ? normalizeAddress(address())
      : kind() === 'email'
        ? emailLink(mail(), subject())
        : place();
  /** New text, only where the text can change and something is typed. */
  const displayText = () => {
    if (!props.target.canSetText) return undefined;
    const t = text();
    if (t.trim()) return t;
    // An empty insertion point takes the address as its text.
    return props.target.text ? undefined : link();
  };
  const previewIndex = () => {
    const p = place();
    const id = slideLinkId(p);
    if (id !== undefined)
      return props.deck.slides.findIndex((s) => s.id === id);
    const last = props.deck.slides.length - 1;
    return {
      '#firstslide': 0,
      '#lastslide': last,
      '#nextslide': Math.min(last, props.current + 1),
      '#previousslide': Math.max(0, props.current - 1),
    }[p];
  };
  const submit = (e?: Event) => {
    e?.preventDefault();
    const target = link();
    if (!target) return;
    props.onApply(target, tip(), displayText());
    props.onClose();
  };

  let addressInput: HTMLInputElement | undefined;
  onMount(() => queueMicrotask(() => addressInput?.focus()));

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="w-[min(620px,94vw)]"
    >
      <form
        class="relative flex flex-col gap-3 p-4"
        data-testid="pptx-link-dialog"
        onSubmit={submit}
      >
        <h2 class="font-semibold text-ink text-sm">
          {editing ? 'Edit Link' : 'Insert Link'}
        </h2>
        <div class="grid grid-cols-2 gap-3">
          <Field label="Text to display">
            <Input
              size="sm"
              class="text-sm"
              data-testid="pptx-link-text"
              disabled={!props.target.canSetText}
              placeholder={
                props.target.canSetText ? '' : '<< Selection in document >>'
              }
              value={props.target.canSetText ? text() : ''}
              onInput={(e) => {
                textTouched = true;
                setText(e.currentTarget.value);
              }}
            />
          </Field>
          <Field label="ScreenTip">
            <Input
              size="sm"
              class="text-sm"
              data-testid="pptx-link-tip"
              placeholder="Shown when pointing at the link"
              value={tip()}
              onInput={(e) => setTip(e.currentTarget.value)}
            />
          </Field>
        </div>
        <div class="flex min-h-64 gap-3">
          <div
            class="flex w-44 shrink-0 flex-col gap-1"
            role="tablist"
            aria-label="Link to"
          >
            <span class="mb-1 font-medium text-ink-muted text-xs">Link to</span>
            <For each={TABS}>
              {(tab) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={kind() === tab.kind}
                  data-testid={`pptx-link-kind-${tab.kind}`}
                  class="flex items-center gap-2 rounded-md px-2 py-2 text-left text-ink text-xs hover:bg-ink/5 [&_svg]:size-4 [&_svg]:shrink-0"
                  classList={{
                    'bg-accent-bg text-accent': kind() === tab.kind,
                  }}
                  onClick={() => setKind(tab.kind)}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              )}
            </For>
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-3">
            <Show when={kind() === 'web'}>
              <Field label="Address">
                <Input
                  ref={addressInput}
                  size="sm"
                  class="text-sm"
                  data-testid="pptx-link-address"
                  placeholder="https://"
                  value={address()}
                  onInput={(e) => {
                    setAddress(e.currentTarget.value);
                    if (!textTouched && props.target.canSetText)
                      setText(e.currentTarget.value);
                  }}
                />
              </Field>
              <p class="text-ink-muted text-xs">
                Web addresses open in a new tab when the link is clicked in a
                slide show, or Ctrl+clicked while editing.
              </p>
            </Show>
            <Show when={kind() === 'place'}>
              <div class="flex min-h-0 gap-3">
                <div
                  class="flex max-h-72 min-w-0 flex-1 flex-col overflow-y-auto rounded-md border border-edge-muted p-1"
                  role="listbox"
                  aria-label="Place in this document"
                  data-testid="pptx-link-places"
                >
                  <span class="px-2 py-1 font-medium text-ink-muted text-xs">
                    Slide show jumps
                  </span>
                  <For each={JUMPS}>
                    {(jump) => (
                      <Place
                        label={jump.label}
                        selected={place() === jump.link}
                        testId={`pptx-link-place-${jump.link.slice(1)}`}
                        onSelect={() => setPlace(jump.link)}
                      />
                    )}
                  </For>
                  <span class="mt-1 px-2 py-1 font-medium text-ink-muted text-xs">
                    Slide titles
                  </span>
                  <For each={props.deck.slides}>
                    {(slide, i) => (
                      <Place
                        label={`${i() + 1}. ${slideTitle(props.deck, slide.id) || `Slide ${i() + 1}`}`}
                        selected={place() === `#slide=${slide.id}`}
                        testId={`pptx-link-place-slide-${i() + 1}`}
                        onSelect={() => setPlace(`#slide=${slide.id}`)}
                      />
                    )}
                  </For>
                </div>
                <div class="flex shrink-0 flex-col gap-1">
                  <span class="text-ink-muted text-xs">Slide preview</span>
                  <Show when={(previewIndex() ?? -1) >= 0}>
                    <SlidePreview
                      engine={props.engine}
                      deck={props.deck}
                      index={previewIndex()!}
                    />
                  </Show>
                </div>
              </div>
            </Show>
            <Show when={kind() === 'email'}>
              <Field label="E-mail address">
                <Input
                  size="sm"
                  class="text-sm"
                  data-testid="pptx-link-email"
                  placeholder="name@example.com"
                  value={mail()}
                  onInput={(e) => {
                    setMail(e.currentTarget.value);
                    if (!textTouched && props.target.canSetText)
                      setText(e.currentTarget.value);
                  }}
                />
              </Field>
              <Field label="Subject">
                <Input
                  size="sm"
                  class="text-sm"
                  data-testid="pptx-link-subject"
                  value={subject()}
                  onInput={(e) => setSubject(e.currentTarget.value)}
                />
              </Field>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-2 pt-1">
          <Show when={editing}>
            <Button
              size="sm"
              variant="ghost"
              data-testid="pptx-link-remove"
              onClick={() => {
                props.onApply('', '');
                props.onClose();
              }}
            >
              Remove Link
            </Button>
          </Show>
          <div class="flex-1" />
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="cta"
            type="submit"
            data-testid="pptx-link-ok"
            disabled={!link()}
          >
            OK
          </Button>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          label="Close"
          class="absolute top-3 right-3"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </form>
    </Dialog>
  );
}

function Place(props: {
  label: string;
  selected: boolean;
  testId: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.selected}
      data-testid={props.testId}
      class="truncate rounded px-2 py-1 text-left text-ink text-xs hover:bg-ink/5"
      classList={{ 'bg-accent-bg text-accent': props.selected }}
      onClick={() => props.onSelect()}
    >
      {props.label}
    </button>
  );
}
