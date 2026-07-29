import type { Component } from 'solid-js';

/**
 * One checklist row.
 */
export type GettingStartedAction = {
  id: string;
  icon: Component<{ class?: string }>;
  title: string;
  description: string;
  /**
   * Run the action's open flow. Return false (or resolve false) when it did
   * not meaningfully activate (failed flow, already-toasted error).
   */
  onActivate: () => void | boolean | Promise<void | boolean>;
  /**
   * Live completion, read reactively from render (read queries/signals
   * synchronously inside). ORed with the persisted set; never persisted
   * itself, so it stays honest when e.g. a tool is disconnected.
   */
  isComplete?: () => boolean;
  /**
   * Register completion observers (createEffect/on, listeners + onCleanup).
   * Runs once at page setup under the page's reactive owner — never create
   * effects inside onActivate.
   */
  observe?: (markComplete: () => void) => void;
  /*
   * Default completion: with neither `isComplete` nor `observe`, a successful
   * onActivate persists completion — "declare no completion condition and
   * clicking it completes it".
   */
};

export type GettingStartedSection = {
  id: string;
  title: string;
  actions: GettingStartedAction[];
};
