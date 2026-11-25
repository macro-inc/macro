/**
 * The fixture-specific executor: it turns a planner decision into the
 * quiz's own controls and nothing else. A choice clicks that label's option;
 * an order clicks every option once, in order; text fills the quiz's input
 * and presses its submit button. No coordinates, no keyboard, no other
 * element.
 */
import type { Locator, Page } from 'playwright';
import type { FamilyName } from './families.ts';
import { FAMILIES } from './families.ts';
import type { PlannerDecision, ResponseSpec } from './planner.ts';
import { TEXT_INPUT_ID, TEXT_SUBMIT_ID } from './registry.ts';

export type Action =
  | { kind: 'choose'; label: string }
  | { kind: 'order'; labels: string[] }
  | { kind: 'transcribe'; text: string };

const OPTION_SELECTOR = 'button[data-lab-option]';
const CLICK_TIMEOUT_MS = 5_000;

/** The visible option controls, by their visible label. */
const optionControls = (page: Page) =>
  page.locator(OPTION_SELECTOR).filter({ visible: true });

const controlFor = (page: Page, label: string): Locator =>
  optionControls(page).filter({
    has: page.locator('.label').getByText(label, { exact: true }),
  });

/**
 * What the planner may answer on this page: the family's response kind
 * with the labels the page shows. Undefined when the page lacks the
 * family's controls.
 */
export const readSpec = async (
  page: Page,
  family: FamilyName
): Promise<ResponseSpec | undefined> => {
  const kind = FAMILIES[family].kind;
  if (kind === 'text') {
    const input = page.locator(`#${TEXT_INPUT_ID}`).filter({ visible: true });
    const submit = page.locator(`#${TEXT_SUBMIT_ID}`).filter({ visible: true });
    const ready = (await input.count()) === 1 && (await submit.count()) === 1;
    return ready ? { kind } : undefined;
  }

  const labels = (
    await optionControls(page).locator('.label').allInnerTexts()
  ).map((label) => label.trim());
  if (labels.length === 0 || new Set(labels).size !== labels.length) {
    return undefined;
  }
  return { kind, labels };
};

export type PreparedAction = {
  action: Action;
  perform: () => Promise<void>;
};

/**
 * Resolves a decision (already checked against the spec) to controls on
 * the page, or undefined if they are not each exactly one element.
 */
export const prepareAction = async (
  page: Page,
  decision: Exclude<PlannerDecision, { kind: 'abort' }>
): Promise<PreparedAction | undefined> => {
  if (decision.kind === 'text') {
    const input = page.locator(`#${TEXT_INPUT_ID}`).filter({ visible: true });
    const submit = page.locator(`#${TEXT_SUBMIT_ID}`).filter({ visible: true });
    if ((await input.count()) !== 1 || (await submit.count()) !== 1) {
      return undefined;
    }
    return {
      action: { kind: 'transcribe', text: decision.text },
      perform: async () => {
        await input.fill(decision.text, { timeout: CLICK_TIMEOUT_MS });
        await submit.click({ timeout: CLICK_TIMEOUT_MS });
      },
    };
  }

  const labels =
    decision.kind === 'choice' ? [decision.label] : decision.labels;
  const controls = labels.map((label) => controlFor(page, label));
  for (const control of controls) {
    if ((await control.count()) !== 1) return undefined;
  }
  return {
    action:
      decision.kind === 'choice'
        ? { kind: 'choose', label: decision.label }
        : { kind: 'order', labels: decision.labels },
    perform: async () => {
      for (const control of controls) {
        await control.click({ timeout: CLICK_TIMEOUT_MS });
      }
    },
  };
};
