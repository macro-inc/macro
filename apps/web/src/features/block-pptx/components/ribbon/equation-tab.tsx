/**
 * The Equation tab (contextual, while an equation is written or selected):
 * built-in equations, the Symbols gallery, and the Structures galleries.
 * Everything picked goes into the equation's linear text at its caret.
 */

import MathOperations from '@phosphor/math-operations.svg';
import TextAa from '@phosphor/text-aa.svg';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import {
  BUILT_IN_EQUATIONS,
  type BuiltInEquation,
  STRUCTURES,
  type StructureGallery,
  SYMBOL_GROUPS,
  symbolId,
  symbolText,
} from '../../core/equations';
import type {
  EquationEditor,
  EquationPicture,
} from '../../primitives/create-equation-editor';
import { matchInk } from '../equation-editor';
import { RibbonGroup, RibbonPopover, RibbonTextButton } from './controls';

/** A rendered picture of linear text (the editor caches them). */
export function EquationThumb(props: {
  editor: EquationEditor;
  latex: string;
  label: string;
}) {
  const [picture, setPicture] = createSignal<EquationPicture>();
  let el!: HTMLSpanElement;
  let alive = true;
  onCleanup(() => {
    alive = false;
  });
  onMount(() => {
    matchInk(props.editor, el);
    void props.editor.thumbnail(props.latex).then((p) => {
      if (alive) setPicture(p);
    });
  });
  return (
    <span ref={el} class="flex min-h-6 items-center justify-center text-ink">
      <Show
        when={picture()}
        fallback={<span class="text-ink-muted text-xs">{props.label}</span>}
      >
        {(p) => (
          <img
            src={p().url}
            alt={props.label}
            draggable={false}
            style={{ width: `${p().width}px`, height: `${p().height}px` }}
          />
        )}
      </Show>
    </span>
  );
}

/** PowerPoint's built-in equations, each shown typeset. */
export function BuiltInEquations(props: {
  editor: EquationEditor;
  onPick: (equation: BuiltInEquation) => void;
}) {
  return (
    <div
      class="flex max-h-[60vh] w-80 flex-col gap-0.5 overflow-y-auto"
      data-testid="pptx-equation-builtins"
    >
      <div class="px-1 pt-1 pb-1 font-medium text-ink-muted text-xs">
        Built-In
      </div>
      <For each={BUILT_IN_EQUATIONS}>
        {(equation) => (
          <button
            type="button"
            data-testid={`pptx-equation-prebuilt-${equation.id}`}
            class="flex flex-col items-start gap-1 rounded-md px-2 py-1.5 text-left hover:bg-ink/5"
            onClick={() => props.onPick(equation)}
          >
            <span class="text-ink text-xs">{equation.name}</span>
            <EquationThumb
              editor={props.editor}
              latex={equation.latex}
              label={equation.name}
            />
          </button>
        )}
      </For>
    </div>
  );
}

function StructureMenu(props: {
  gallery: StructureGallery;
  editor: EquationEditor;
  disabled: boolean;
}) {
  return (
    <RibbonPopover
      label={props.gallery.label}
      text={props.gallery.label}
      icon={<span class="sr-only">{props.gallery.label}</span>}
      disabled={props.disabled}
      testId={`pptx-equation-structure-${props.gallery.id}`}
    >
      {(close) => (
        <div class="grid max-h-[60vh] w-72 grid-cols-3 gap-1 overflow-y-auto">
          <For each={props.gallery.items}>
            {(item, i) => (
              <button
                type="button"
                title={item.label}
                aria-label={item.label}
                data-testid={`pptx-equation-structure-${props.gallery.id}-${i()}`}
                class="flex h-14 items-center justify-center overflow-hidden rounded-md border border-edge-muted hover:border-accent hover:bg-ink/5"
                onClick={() => {
                  close();
                  props.editor.insert(item.latex);
                }}
              >
                <EquationThumb
                  editor={props.editor}
                  latex={item.latex}
                  label={item.label}
                />
              </button>
            )}
          </For>
        </div>
      )}
    </RibbonPopover>
  );
}

export function EquationTab(props: {
  editor: EquationEditor;
  readonly: boolean;
}) {
  const eq = props.editor;
  return (
    <>
      <RibbonGroup label="Tools">
        <RibbonPopover
          label="Equation"
          text="Equation"
          icon={<MathOperations class="size-3.5" />}
          disabled={props.readonly}
          testId="pptx-equation-prebuilt"
        >
          {(close) => (
            <BuiltInEquations
              editor={eq}
              onPick={(equation) => {
                close();
                eq.reveal();
                eq.setLatex(equation.latex);
              }}
            />
          )}
        </RibbonPopover>
        <RibbonTextButton
          label="Linear format"
          tooltip="Edit the equation as linear (LaTeX) text"
          data-testid="pptx-equation-linear"
          disabled={props.readonly}
          onClick={() => eq.reveal(true)}
        >
          <TextAa />
          Linear
        </RibbonTextButton>
        <RibbonTextButton
          label="Display"
          tooltip="Put the equation on its own line (display) or inline"
          aria-pressed={eq.display()}
          class={eq.display() ? 'bg-accent-bg text-accent' : undefined}
          data-testid="pptx-equation-display-toggle"
          disabled={props.readonly}
          onClick={() => {
            eq.reveal();
            eq.setDisplay(!eq.display());
          }}
        >
          Display
        </RibbonTextButton>
      </RibbonGroup>
      <RibbonGroup label="Symbols">
        <RibbonPopover
          label="Symbols"
          text="Symbols"
          icon={<span class="text-sm leading-none">±∞</span>}
          disabled={props.readonly}
          testId="pptx-equation-symbols"
        >
          {(close) => (
            <div class="flex max-h-[60vh] w-80 flex-col gap-1 overflow-y-auto">
              <For each={SYMBOL_GROUPS}>
                {(group) => (
                  <div class="flex flex-col gap-0.5">
                    <div class="px-1 pt-1 font-medium text-ink-muted text-xs">
                      {group.label}
                    </div>
                    <div class="flex flex-wrap">
                      <For each={group.symbols}>
                        {(symbol) => (
                          <button
                            type="button"
                            title={
                              symbol.command
                                ? `${symbol.char}  ${symbolText(symbol).trim()}`
                                : symbol.char
                            }
                            data-testid={`pptx-equation-symbol-${symbolId(symbol)}`}
                            class="flex size-7 items-center justify-center rounded-md text-ink text-sm hover:bg-ink/5"
                            onClick={() => {
                              close();
                              eq.insert(symbolText(symbol));
                            }}
                          >
                            {symbol.char}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Structures">
        <For each={STRUCTURES}>
          {(gallery) => (
            <StructureMenu
              gallery={gallery}
              editor={eq}
              disabled={props.readonly}
            />
          )}
        </For>
      </RibbonGroup>
    </>
  );
}
