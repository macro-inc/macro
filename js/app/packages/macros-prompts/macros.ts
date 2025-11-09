import { createBlockSignal } from '@core/block';
import { iconMap } from '@core/component/IconSelectorMenu';
import { isErr } from '@core/util/maybeResult';
import ArrowsClockwiseIcon from '@phosphor-icons/core/regular/arrows-clockwise.svg?component-solid';
import FunnelXIcon from '@phosphor-icons/core/regular/funnel-x.svg?component-solid';
import LightningIcon from '@phosphor-icons/core/regular/lightning.svg?component-solid';
import MagnifyingGlassIcon from '@phosphor-icons/core/regular/magnifying-glass.svg?component-solid';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { FilteredTailwindColors } from 'core/component/TailwindColorPicker';
import {
  type Component,
  type ComponentProps,
  createResource,
  createSignal,
} from 'solid-js';

export type MacroPrompt = {
  id: string;
  title: string;
  prompt: string;
  icon: Component<ComponentProps<'svg'>>;
  color: FilteredTailwindColors;
  requiredDocs?: number;
  // TODO-M-185
  // dssFileIds: string[]
};

export const ENABLE_MACROS_IN_CHAT = true;
export const ENABLE_SEARCH_MACROS = false;
export const ENABLE_EDIT_MACROS = true;

// TODO- remove hardcoded in M-187
export const PRELOADED_MACROS: MacroPrompt[] = [
  {
    id: '1',
    title: 'Compare Summarizer',
    icon: ArrowsClockwiseIcon,
    color: 'green',
    prompt: `Operate as a compare tool that can meticulously identify the differences between two documents.
Compare the two documents attached and summarize the key points in a table.
Then, extract all specific differences/changes and list in numbered format.`,
  },
  {
    id: '2',
    title: 'Redline Change Summary',
    icon: FunnelXIcon,
    color: 'red',
    prompt: `I want you to act as a legal Compare Change summary AI. I am going to give you a document and your task is to summarize all the changes in the agreement as a table. Do not include the name of the document in your reply.

Here are the columns to use in your table:

1. Section (clause or term). If the clause is not named and just numbered in the document, choose either to use the name of the enclosing clause or to make a name based on the clause e.g. if the clause is not labeled termination but has to do with termination, label it "Termination (11.1)".
2. The change, verbatim. Use [[insertion]] to represent insertions (blue) and ~~deletion~~ to represent deleted text (red).
3. Short summary of the change;
4. Commercial or legal.
5. The author of the change (author name field).

It is very important that you DO NOT MISS ANY REDLINES i.e. include redlines in the document. Make sure to present your table IN ORDER from first page to last.`,
  },
  {
    id: '3',
    title: 'Plan out my day',
    icon: LightningIcon,
    color: 'purple',
    prompt: `Please act as my personal assistant. I need you to plan out my day and structure my tasks.
If I add any documents to the chat, please incorporate them into my daily agenda.

Otherwise, the following represent things I need to get done today:

[INSERT LIST OF TASKS HERE]`,
  },
  {
    id: '4',
    title: 'Find Info from a Document',
    icon: MagnifyingGlassIcon,
    color: 'orange',
    prompt: `Operate as a search tool that can meticulously pull out information from a document.
Search the attached document for the following information:

`,
  },
];

// TODO- not adding to the list right away
// TODO- not keeping the preloaded macros

function getIconComponent(icon: string): Component<ComponentProps<'svg'>> {
  const component = iconMap[icon];
  if (!component) {
    console.warn(`Icon ${icon} not found, falling back to ArrowsClockwiseIcon`);
    return ArrowsClockwiseIcon;
  }
  return component;
}

export async function createMacro(macro: MacroPrompt) {
  // Find the icon name by comparing the component with the values in iconMap
  const iconName =
    Object.entries(iconMap).find(
      ([, component]) => component === macro.icon
    )?.[0] ?? 'ArrowsClockwiseIcon';

  const macroDbObject = {
    ...macro,
    icon: iconName,
  };

  const result = await cognitionApiServiceClient.createMacro(macroDbObject);
  if (isErr(result)) return false;
  return true;
}

export async function createNewAndUpdateMacros(newMacro: MacroPrompt) {
  const success = await createMacro(newMacro);
  if (success) {
    mutate((current) => [...(current ?? []), newMacro]);
    await refetch(); // TODO- is this needed?
  }
  return success;
}

function createMacroPromptFromDbObject(dbMacro: any): MacroPrompt {
  return {
    ...dbMacro,
    icon: getIconComponent(dbMacro.icon),
  };
}

async function getMacros(): Promise<MacroPrompt[]> {
  const result = await cognitionApiServiceClient.getMacros();
  if (isErr(result)) return [];
  const [, data] = result;
  // Map server response to MacroPrompt type
  // TODO- this is annoying but works, the openapi.json is wrong
  // @ts-ignore
  return data.map(createMacroPromptFromDbObject);
}

export async function editExistingMacro(macro: MacroPrompt) {
  // TODO- wait for backend to support this
  // @ts-ignore
  const _result = await cognitionApiServiceClient.updateMacro({
    macro_prompt_id: macro.id,
    ...macro,
  });
  mutate((current) => current?.map((m) => (m.id === macro.id ? macro : m)));
  return true;
}

export async function deleteMacro(id: string) {
  // TODO- wait for backend to support this
  // @ts-ignore
  const _result = await cognitionApiServiceClient.deleteMacro({
    macro_prompt_id: id,
  });
  mutate((current) => current?.filter((m) => m.id !== id));
  return true;
}

export const [macros, { mutate, refetch }] = createResource(getMacros, {
  initialValue: PRELOADED_MACROS,
});

type ModalMode = {
  type: 'create' | 'edit';
  macro?: MacroPrompt;
};

export const [macroModalState, setMacroModalState] =
  createSignal<ModalMode | null>(null);
export const macroSignal = createBlockSignal<MacroPrompt | null>(null);

export function setInputToMacroPrompt(
  inputRef: HTMLDivElement | null,
  macro: MacroPrompt | null
) {
  if (!inputRef) return;
  if (!macro) {
    inputRef.innerText = '';
  }
  if (inputRef && macro) {
    inputRef.innerText = macro.prompt;
  }
  inputRef.dispatchEvent(new Event('input', { bubbles: true }));

  // TODO- set files to be MacroPromptFiles
  // TODO- M-191
  // one more param where the arg is a function to call that takes a DSS file and does something (e.g. set the chat)
  // Copy teo's @ reference in chat
}
