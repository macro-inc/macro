import { Panel } from '@ui';
import type { JSX } from 'solid-js';

/**
 * The parts of the Add an agent form, which a layout arranges. Each part is
 * built by `InviteAgentForm`; a layout only places them, so another layout
 * (a face-led or a catalog one) can replace this one without touching the
 * form's state.
 */
export type AgentInviteParts = {
  /** The Name label, the face (or initials) and the name input. */
  name: JSX.Element;
  /** The Computer label and its sizes, or their loading or error state. */
  computer: JSX.Element;
  /** What went wrong with the last Add, if anything. */
  notice: JSX.Element;
  cancel: JSX.Element;
  submit: JSX.Element;
};

/**
 * Layout A: name with its face, then the computer, then the actions. Body and
 * footer share one 20px inset, so the cards, the fields and the buttons line
 * up on both edges.
 */
export function AgentInviteLayoutA(props: AgentInviteParts) {
  return (
    <>
      <Panel.Body scroll>
        <div class="flex flex-col gap-5 px-5 py-5">
          {props.name}
          {props.computer}
          {props.notice}
        </div>
      </Panel.Body>
      {/* When Add's label needs a row of its own, it goes above Cancel. */}
      <Panel.Footer class="flex-wrap-reverse justify-end gap-2 px-5 py-3">
        {props.cancel}
        {props.submit}
      </Panel.Footer>
    </>
  );
}
