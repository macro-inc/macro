import type { Accessor, JSX } from 'solid-js';
import type {
  EventTriggerDraft,
  RoutineEventGroup,
} from '../core/routine-triggers';

/** What the routine page supplies to edit event triggers: pickers and labels. */
export type EventSlots = {
  renderEventLabel: (trigger: Accessor<EventTriggerDraft>) => JSX.Element;
  renderEventScope: (
    trigger: Accessor<EventTriggerDraft>,
    change: (ids: string[] | undefined) => void
  ) => JSX.Element;
  /** Picks among the owner's inboxes; absent where inboxes can't be picked. */
  renderInboxPicker?: (
    inboxes: Accessor<string[]>,
    change: (inboxes: string[]) => void
  ) => JSX.Element;
  /** Names picked inboxes: "team@example.com", "2 inboxes". */
  renderInboxesLabel?: (inboxes: string[]) => JSX.Element;
  /** Settings particular to some events, such as GitHub's selector. */
  renderEventSettings?: (
    trigger: Accessor<EventTriggerDraft>,
    change: (patch: Partial<EventTriggerDraft>) => void
  ) => JSX.Element;
  /** Absent where conditions are unavailable. */
  renderEventCondition?: (
    trigger: Accessor<EventTriggerDraft>,
    change: (condition: string | undefined) => void
  ) => JSX.Element;
  /** Wraps a group's choices, e.g. to ask for an account they need first. */
  renderEventGroup?: (
    group: RoutineEventGroup,
    options: () => JSX.Element
  ) => JSX.Element;
  /** False hides event triggers from the menu; existing ones stay editable. */
  offerEvents?: boolean;
};
