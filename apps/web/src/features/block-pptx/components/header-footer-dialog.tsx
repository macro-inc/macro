/**
 * Insert ▸ Header & Footer (PowerPoint's Slide tab): date and time
 * (automatic in a chosen format, or fixed text), slide number, footer, and
 * "Don't show on title slide", with a preview of where they go. Apply changes
 * the selected slides; Apply to All changes every slide and the slides added
 * later.
 */

import type { DeckOutline, SlideOutline } from '@core/pptx-engine/types';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Input, inputClasses } from '@ui/components/Input';
import { For, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  DATE_FORMATS,
  formatDate,
  type HeaderFooterForm,
  initialForm,
} from '../core/header-footer';

function Check(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  testId: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      class="flex items-center gap-2 text-ink text-sm"
      classList={{ 'opacity-50': props.disabled }}
    >
      <input
        type="checkbox"
        class="size-3.5 accent-accent"
        checked={props.checked}
        disabled={props.disabled}
        data-testid={props.testId}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      {props.label}
    </label>
  );
}

function Radio(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  testId: string;
  onSelect: () => void;
}) {
  return (
    <label
      class="flex items-center gap-2 text-ink text-sm"
      classList={{ 'opacity-50': props.disabled }}
    >
      <input
        type="radio"
        name="pptx-hf-date-mode"
        class="size-3.5 accent-accent"
        checked={props.checked}
        disabled={props.disabled}
        data-testid={props.testId}
        onChange={() => props.onSelect()}
      />
      {props.label}
    </label>
  );
}

/**
 * A slide (paper white, as slides are) with the three elements where layouts
 * usually put them: dark when shown, outlined when not.
 */
function Preview(props: { form: HeaderFooterForm; aspect: number }) {
  const box = (on: boolean, style: JSX.CSSProperties) => (
    <span
      class="absolute h-[8%] border"
      classList={{
        'border-[#262626] bg-[#262626]': on,
        'border-[#a6a6a6] border-dashed bg-[white]': !on,
      }}
      style={style}
    />
  );
  return (
    <div
      class="relative w-full border border-edge bg-[white] shadow-sm"
      style={{ 'aspect-ratio': `${1 / props.aspect}` }}
      data-testid="pptx-hf-preview"
      aria-hidden="true"
    >
      <span class="absolute top-[12%] left-[8%] h-[14%] w-[84%] border border-[#bfbfbf]" />
      <span class="absolute top-[32%] left-[8%] h-[46%] w-[84%] border border-[#bfbfbf]" />
      {box(props.form.date, { left: '5%', bottom: '5%', width: '24%' })}
      {box(props.form.footer, { left: '33%', bottom: '5%', width: '34%' })}
      {box(props.form.slideNumber, {
        right: '5%',
        bottom: '5%',
        width: '12%',
      })}
    </div>
  );
}

export function HeaderFooterDialog(props: {
  deck: DeckOutline;
  /** The current slide (the dialog starts from what it shows). */
  slide: SlideOutline | undefined;
  /** How many slides Apply changes. */
  selectedCount: number;
  readonly: boolean;
  onApply: (form: HeaderFooterForm, all: boolean) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const [form, setForm] = createStore<HeaderFooterForm>(
    initialForm(props.deck, props.slide, now)
  );
  const ro = () => props.readonly;
  const apply = (all: boolean) => {
    props.onApply({ ...form }, all);
    props.onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="w-[min(560px,94vw)]"
    >
      <div
        class="relative flex flex-col gap-3 p-4"
        data-testid="pptx-header-footer"
      >
        <h2 class="font-semibold text-ink text-sm">Header and Footer</h2>
        <div class="flex border-edge-muted border-b text-xs">
          <span class="-mb-px border-accent border-b-2 px-2 pb-1.5 font-medium text-ink">
            Slide
          </span>
        </div>
        <div class="flex gap-5">
          <fieldset class="flex min-w-0 flex-1 flex-col gap-2">
            <legend class="mb-2 font-medium text-ink-muted text-xs">
              Include on slide
            </legend>
            <Check
              label="Date and time"
              checked={form.date}
              disabled={ro()}
              testId="pptx-hf-date"
              onChange={(v) => setForm('date', v)}
            />
            <div class="ml-5.5 flex flex-col gap-1.5">
              <Radio
                label="Update automatically"
                checked={form.dateMode === 'auto'}
                disabled={ro() || !form.date}
                testId="pptx-hf-date-auto"
                onSelect={() => setForm('dateMode', 'auto')}
              />
              <select
                class={inputClasses({
                  size: 'sm',
                  class: 'ml-5.5 w-[calc(100%-1.375rem)] text-sm',
                })}
                aria-label="Date format"
                data-testid="pptx-hf-date-format"
                disabled={ro() || !form.date || form.dateMode !== 'auto'}
                value={form.dateFormat}
                onChange={(e) =>
                  setForm(
                    'dateFormat',
                    e.currentTarget.value as HeaderFooterForm['dateFormat']
                  )
                }
              >
                <For each={DATE_FORMATS}>
                  {(format) => (
                    <option value={format}>{formatDate(format, now)}</option>
                  )}
                </For>
              </select>
              <Radio
                label="Fixed"
                checked={form.dateMode === 'fixed'}
                disabled={ro() || !form.date}
                testId="pptx-hf-date-fixed"
                onSelect={() => setForm('dateMode', 'fixed')}
              />
              <Input
                size="sm"
                class="ml-5.5 w-[calc(100%-1.375rem)] text-sm"
                aria-label="Fixed date"
                data-testid="pptx-hf-date-fixed-text"
                disabled={ro() || !form.date || form.dateMode !== 'fixed'}
                value={form.dateText}
                onInput={(e) => setForm('dateText', e.currentTarget.value)}
              />
            </div>
            <Check
              label="Slide number"
              checked={form.slideNumber}
              disabled={ro()}
              testId="pptx-hf-slide-number"
              onChange={(v) => setForm('slideNumber', v)}
            />
            <Check
              label="Footer"
              checked={form.footer}
              disabled={ro()}
              testId="pptx-hf-footer"
              onChange={(v) => setForm('footer', v)}
            />
            <Input
              size="sm"
              class="ml-5.5 w-[calc(100%-1.375rem)] text-sm"
              aria-label="Footer text"
              data-testid="pptx-hf-footer-text"
              disabled={ro() || !form.footer}
              value={form.footerText}
              onInput={(e) => setForm('footerText', e.currentTarget.value)}
            />
            <div class="mt-2">
              <Check
                label="Don't show on title slide"
                checked={form.notOnTitle}
                disabled={ro()}
                testId="pptx-hf-not-on-title"
                onChange={(v) => setForm('notOnTitle', v)}
              />
            </div>
          </fieldset>
          <div class="flex w-40 shrink-0 flex-col gap-2">
            <span class="font-medium text-ink-muted text-xs">Preview</span>
            <Preview
              form={form}
              aspect={props.deck.height / props.deck.width}
            />
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid="pptx-hf-apply"
            disabled={ro()}
            tooltip={
              props.selectedCount > 1
                ? `Apply to the ${props.selectedCount} selected slides`
                : 'Apply to this slide'
            }
            onClick={() => apply(false)}
          >
            Apply
          </Button>
          <Button
            size="sm"
            variant="cta"
            data-testid="pptx-hf-apply-all"
            disabled={ro()}
            onClick={() => apply(true)}
          >
            Apply to All
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
      </div>
    </Dialog>
  );
}
