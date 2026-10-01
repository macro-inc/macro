import { HomepageConversation } from '../HomepageConversation';
import HomepageEmailCompose from '../HomepageEmailCompose';
import { HomepageMention } from '../HomepageMention';
import './email-agentic-editing.css';

/** The homepage conversation and editable draft, kept local to this demo. */
export function EmailAgenticEditingDemo() {
  return (
    <div class="email-editing-stage">
      <HomepageConversation
        messages={[
          {
            person: 'julia',
            text: 'Dana wants to invite her team. Are we still on for Thursday?',
          },
          {
            person: 'jacob',
            text: (
              <>
                <span class="homepage-person-mention">@Claude</span>, draft a
                follow-up email based on{' '}
                <HomepageMention
                  kind="call"
                  label="Demo call transcript"
                  description="The demo with Dana: team rollout, sales materials, and next steps."
                  href="#agentic-editing"
                />
                . Include the sales PDF and rollout doc, and cc Julia.
              </>
            ),
          },
        ]}
      />
      <HomepageEmailCompose appChrome />
    </div>
  );
}
