import ArrowBendDownRight from '@phosphor/arrow-bend-down-right.svg';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import DotsThree from '@phosphor/dots-three.svg';
import ShieldCheck from '@phosphor/shield-check.svg';
import Trash from '@phosphor/trash.svg';
import { cn, Dropdown } from '@ui';
import { type JSX, Show } from 'solid-js';

/** The menu every section and gate has: move it, or delete it. */
export function SectionMenu(props: {
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  deleteLabel: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger variant="ghost" size="icon-sm" aria-label={props.label}>
        <DotsThree />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-52">
        <Dropdown.Item disabled={!props.canMoveUp} onSelect={props.onMoveUp}>
          <ArrowUp class="size-4" />
          <span class="flex-1">Move up</span>
        </Dropdown.Item>
        <Dropdown.Item
          disabled={!props.canMoveDown}
          onSelect={props.onMoveDown}
        >
          <ArrowDown class="size-4" />
          <span class="flex-1">Move down</span>
        </Dropdown.Item>
        <Dropdown.Separator class="my-1 h-px bg-edge-divider" />
        <Dropdown.Item class="text-failure-ink" onSelect={props.onDelete}>
          <Trash class="size-4" />
          <span class="flex-1">{props.deleteLabel}</span>
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** "After section 1 → Continue to section 2": linear in this pass, kept for branching. */
export function RoutingFooter(props: { after: string; next: string }) {
  return (
    <div class="flex items-center gap-2 border-t border-edge-divider px-4 py-2 text-xs text-ink-muted">
      <ArrowBendDownRight class="size-3.5" aria-hidden="true" />
      <span>After {props.after}</span>
      <span aria-hidden="true">→</span>
      <span class="rounded-full border border-edge-muted px-2 py-0.5 text-ink">
        {props.next}
      </span>
    </div>
  );
}

/**
 * A group of questions: eyebrow, title, description, its question rows.
 * Focusing its header or empty body makes it where the next question goes.
 */
export function SectionCard(props: {
  sectionId: string;
  eyebrow: string;
  title: string;
  description: string;
  questionCount: number;
  dragging: boolean;
  /** New questions go to this section's end. */
  targeted: boolean;
  onTarget: () => void;
  /** Adds a question into this section; shown while it is empty. */
  addQuestion: JSX.Element;
  handle: JSX.Element;
  menu: JSX.Element;
  routing: JSX.Element;
  children: JSX.Element;
  empty: boolean;
  onTitle: (title: string) => void;
  onDescription: (description: string) => void;
}) {
  return (
    <section
      aria-label={props.title || props.eyebrow}
      data-drag-source
      data-form-section={props.sectionId}
      data-section-kind="questions"
      class={cn(
        'overflow-hidden rounded-xl border border-edge bg-surface shadow-xs transition-opacity',
        props.targeted && 'border-edge-focus',
        props.dragging && 'opacity-40'
      )}
    >
      <header
        class="flex items-start gap-1 border-b border-edge-divider px-2 pt-3 pb-2"
        onFocusIn={(event) => {
          if (!(event.target instanceof HTMLButtonElement)) props.onTarget();
        }}
      >
        <div class="pt-0.5">{props.handle}</div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex items-center gap-2 px-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            <span>{props.eyebrow}</span>
            <span aria-hidden="true">·</span>
            <span>
              {props.questionCount === 1
                ? '1 question'
                : `${props.questionCount} questions`}
            </span>
          </div>
          <input
            aria-label="Section title"
            placeholder="Untitled section"
            value={props.title}
            maxlength={200}
            class="h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-base font-semibold text-ink outline-none placeholder:text-ink-placeholder hover:border-edge-muted focus:border-edge-focus focus:bg-input"
            onInput={(event) => props.onTitle(event.currentTarget.value)}
          />
          <input
            aria-label="Section description"
            placeholder="Description (optional)"
            value={props.description}
            maxlength={2000}
            class="h-7 w-full rounded-md border border-transparent bg-transparent px-1.5 text-xs text-ink-muted outline-none placeholder:text-ink-placeholder hover:border-edge-muted focus:border-edge-focus focus:bg-input"
            onInput={(event) => props.onDescription(event.currentTarget.value)}
          />
        </div>
        {props.menu}
      </header>
      <div
        data-form-section-list={props.sectionId}
        class="flex min-h-16 flex-col divide-y divide-edge-divider"
      >
        <Show
          when={!props.empty}
          fallback={
            <div class="flex min-h-16 flex-col items-center justify-center gap-2 px-4 py-3 text-xs text-ink-muted">
              <span>No questions yet. Add one, or drag a question here.</span>
              <div class="w-44">{props.addQuestion}</div>
            </div>
          }
        >
          {props.children}
        </Show>
      </div>
      {props.routing}
    </section>
  );
}

/**
 * A gate: rules over earlier answers, evaluated on submit. Respondents never
 * see the rules, only the message when one fails.
 */
export function GateCard(props: {
  sectionId: string;
  eyebrow: string;
  title: string;
  sentence: string | undefined;
  message: string;
  dragging: boolean;
  editingRules: boolean;
  handle: JSX.Element;
  menu: JSX.Element;
  ruleEditor: JSX.Element;
  noQuestionsBefore: boolean;
  /** Rules testing questions no longer asked before the gate. */
  brokenRules: number;
  onRepair: () => void;
  onTitle: (title: string) => void;
  onMessage: (message: string) => void;
  onEditRules: () => void;
}) {
  return (
    <section
      aria-label={props.title || props.eyebrow}
      data-drag-source
      data-form-section={props.sectionId}
      data-section-kind="gate"
      class={cn(
        'overflow-hidden rounded-xl border border-dashed border-edge bg-panel transition-opacity',
        props.dragging && 'opacity-40'
      )}
    >
      <header class="flex items-start gap-1 px-2 pt-3 pb-2">
        <div class="pt-0.5">{props.handle}</div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex items-center gap-1.5 px-1.5 text-[11px] font-medium tracking-wide text-amber-ink uppercase">
            <ShieldCheck class="size-3.5" aria-hidden="true" />
            <span>{props.eyebrow}</span>
          </div>
          <input
            aria-label="Gate title"
            placeholder="Untitled gate"
            value={props.title}
            maxlength={200}
            class="h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-base font-semibold text-ink outline-none placeholder:text-ink-placeholder hover:border-edge-muted focus:border-edge-focus focus:bg-input"
            onInput={(event) => props.onTitle(event.currentTarget.value)}
          />
        </div>
        {props.menu}
      </header>
      <div class="flex flex-col gap-3 px-4 pb-4">
        <Show when={props.brokenRules > 0}>
          <div
            role="alert"
            class="flex flex-wrap items-center gap-2 rounded-lg border border-failure/40 bg-failure-bg px-3 py-2 text-xs text-failure-ink"
          >
            <span class="flex-1">
              {props.brokenRules === 1
                ? 'A rule checks a question that is no longer before this gate. Responses are refused until it is fixed.'
                : `${props.brokenRules} rules check questions that are no longer before this gate. Responses are refused until they are fixed.`}
            </span>
            <button
              type="button"
              class="rounded-md px-1 font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-edge-focus"
              onClick={props.onRepair}
            >
              Remove broken rules
            </button>
          </div>
        </Show>
        <Show
          when={!props.noQuestionsBefore}
          fallback={
            <p class="rounded-lg border border-edge-muted bg-surface px-3 py-2 text-xs text-ink-muted">
              A gate checks answers from the sections before it. Move it below a
              section with questions to add rules.
            </p>
          }
        >
          <div class="rounded-lg border border-edge-muted bg-surface px-3 py-2">
            <Show
              when={props.sentence}
              fallback={
                <p class="text-sm text-ink-muted">
                  No rules yet: everyone continues.
                </p>
              }
            >
              <p class="font-mono text-xs leading-relaxed text-ink wrap-anywhere">
                {props.sentence}
              </p>
            </Show>
          </div>
          <Show
            when={props.editingRules}
            fallback={
              <button
                type="button"
                class="self-start rounded-md px-1 text-xs font-medium text-accent-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-edge-focus"
                onClick={props.onEditRules}
              >
                {props.sentence ? 'Edit rules' : 'Add rule'}
              </button>
            }
          >
            {props.ruleEditor}
          </Show>
        </Show>
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-ink-muted">
            Message when a rule fails
          </span>
          <textarea
            value={props.message}
            maxlength={2000}
            rows={2}
            class="w-full resize-y rounded-md border border-edge-muted bg-input px-2.5 py-1.5 text-sm text-ink outline-none focus:border-edge-focus"
            onInput={(event) => props.onMessage(event.currentTarget.value)}
          />
        </label>
        <p class="text-[11px] text-ink-muted">
          Rules are sent to respondents’ browsers. Keep confidential information
          out of them. A response that fails one is not saved.
        </p>
      </div>
    </section>
  );
}
