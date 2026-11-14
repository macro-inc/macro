import { DemoMention } from '../DemoMention';
import type { HomepageMessage } from '../HomepageConversation';
import { HomepageMention } from '../HomepageMention';

/** A teammate asks for a follow-up, and the reply hands the draft to an agent. */
export const emailDraftMessages = (
  transcriptHref: string,
  draftHref: string
): readonly HomepageMessage[] => [
  {
    person: 'eric',
    text: (
      <>
        Can you send{' '}
        <DemoMention item={{ id: 'austin', label: 'Austin', kind: 'person' }} />{' '}
        the demo follow-up?
      </>
    ),
  },
  {
    person: 'jacob',
    text: (
      <>
        <DemoMention item={{ id: 'macro', label: 'Macro', kind: 'person' }} />{' '}
        draft a followup from{' '}
        <HomepageMention
          kind="call"
          label="Demo call transcript"
          description="Transcript of the September 14 demo with Austin · Team rollout, sales materials, and follow-up next steps."
          href={transcriptHref}
        />
        . Link the{' '}
        <HomepageMention
          kind="pdf"
          label="sales PDF"
          description="Sales overview from the demo."
          href={draftHref}
        />{' '}
        and rollout plan.
      </>
    ),
  },
];
