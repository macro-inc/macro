import { createSignal, For } from 'solid-js';
import { createCrmDemoWorkspace } from '../../primitives/createCrmDemoWorkspace';
import { AgentSession } from '../agents/AgentSession';
import {
  AgentAnswer,
  type AgentMention,
  AgentPrompt,
  type AgentToolCall,
  AgentToolGroup,
  AgentTurn,
} from '../agents/AgentTranscript';
import { CrmRecordWorkspace } from '../crm/CrmRecordWorkspace';
import { seedCrmFollowup } from '../crm/crm-followup-data';
import { ProductDemo } from '../product/ProductPage';
import type { CompanySection } from '../workspace/WorkspaceCompanies';
import './drive-stories.css';

const calls: AgentToolCall[] = [
  {
    kind: 'search',
    query: 'Parlor Studio support terms',
    scope: 'document',
    hits: [
      {
        kind: 'document',
        title: 'Parlor Studio contract.pdf',
        snippet:
          'Support requests receive a response within four business hours.',
        time: 'Sep 25',
      },
      {
        kind: 'document',
        title: 'Website launch plan',
        snippet: 'Julia owns onboarding for Parlor Studio through launch week.',
        time: '9:12 AM',
      },
      {
        kind: 'document',
        title: 'Launch budget.xlsx',
        snippet: 'Onboarding and support: 40 hours in the first month.',
        time: 'Sep 28',
      },
    ],
  },
  { kind: 'read-document', title: 'Parlor Studio contract.pdf' },
];
const mentions: Record<string, AgentMention> = {
  contract: { kind: 'document' },
  plan: { kind: 'document' },
  budget: { kind: 'document' },
};
const answer =
  'The @[Parlor Studio contract.pdf](agent:contract) promises a reply within four business hours, on weekdays.\n\nThe @[Website launch plan](agent:plan) puts Julia on their onboarding through launch week, and the @[Launch budget.xlsx](agent:budget) sets aside 40 hours for it in the first month.';

/** An agent answers a question from the files in Drive and cites each one. */
export function DriveAgentDemo() {
  const [turns, setTurns] = createSignal<string[]>([]);
  return (
    <ProductDemo
      label="An agent answers a question from the files in Drive"
      height={500}
      mobileHeight={600}
    >
      <div class="drive-agent">
        <AgentSession
          title="Parlor Studio support"
          onSend={(text) => setTurns((all) => [...all, text])}
        >
          <AgentTurn>
            <AgentPrompt text="What support did we promise Parlor Studio?" />
          </AgentTurn>
          <AgentTurn>
            <AgentToolGroup calls={calls} defaultOpen />
            <AgentAnswer text={answer} mentions={mentions} />
          </AgentTurn>
          <For each={turns()}>
            {(text) => (
              <AgentTurn>
                <AgentPrompt text={text} />
              </AgentTurn>
            )}
          </For>
        </AgentSession>
      </div>
    </ProductDemo>
  );
}

/** A company record opened on its Files tab. */
export function DriveRecordFilesDemo() {
  const w = createCrmDemoWorkspace();
  seedCrmFollowup(w);
  w.open('crm', 'meadow');
  const [section, setSection] = createSignal<CompanySection>('files');
  return (
    <ProductDemo
      label="Parlor Studio’s files on its company record"
      height={330}
      mobileHeight={380}
    >
      <CrmRecordWorkspace
        workspace={w}
        section={section()}
        onSectionChange={setSection}
      />
    </ProductDemo>
  );
}
