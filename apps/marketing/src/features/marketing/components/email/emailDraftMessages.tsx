import { DemoMention } from '../DemoMention';
import type { HomepageMessage } from '../HomepageConversation';
import { HomepageMention } from '../HomepageMention';

/** A teammate asks for a follow-up, and the reply hands the draft to an agent. */
export const emailDraftMessages = (
  transcriptHref: string
): readonly HomepageMessage[] => [
  {
    person: 'eric',
    text: 'Can you send Austin Barron the demo follow-up?',
  },
  {
    person: 'jacob',
    text: (
      <>
        <DemoMention item={{ id: 'macro', label: 'Macro', kind: 'person' }} />{' '}
        draft Austin Barron’s follow-up from{' '}
        <HomepageMention
          kind="call"
          label="Demo call transcript"
          description="Transcript of the September 14 demo with Austin Barron · Team rollout, sales materials, and follow-up next steps."
          href={transcriptHref}
        />
        . Link the sales PDF and rollout plan. Cc Julia.
      </>
    ),
  },
];
