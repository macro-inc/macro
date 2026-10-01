import Buildings from '@phosphor/buildings.svg';
import Check from '@phosphor/check.svg';
import Globe from '@phosphor/globe.svg';
import MapPin from '@phosphor/map-pin.svg';
import Users from '@phosphor/users-three.svg';
import { createSignal, For, Show } from 'solid-js';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';

const companyFacts = [
  { label: 'Website', value: 'meadow.example', icon: Globe },
  { label: 'Industry', value: 'Design services', icon: Buildings },
  { label: 'Headquarters', value: 'Brooklyn, New York', icon: MapPin },
  { label: 'Company size', value: '24 employees', icon: Users },
];

/** Fictional enrichment values arrive on the record, without a live lookup. */
export function CrmEnrichmentDemo() {
  let root!: HTMLDivElement;
  const [revealed, setRevealed] = createSignal(0);
  createEmailWalkthrough({
    root: () => root,
    steps: companyFacts.length,
    advance: setRevealed,
    reset: () => setRevealed(0),
    reduced: () => setRevealed(companyFacts.length),
  });
  return (
    <div
      ref={root}
      class="crm-enrichment-demo crm-editorial-window glass-input"
      role="group"
      aria-label="Company information added from an email domain"
    >
      <div class="crm-editorial-toolbar">
        <Buildings />
        <span>Customers</span>
        <span class="crm-toolbar-divider">/</span>
        <span>The Meadow</span>
      </div>
      <div class="crm-enrichment-body">
        <div class="crm-enrichment-profile">
          <div class="crm-enrichment-mark" aria-hidden="true">
            m.
          </div>
          <h3>The Meadow</h3>
          <span class="crm-enrichment-domain">
            <Globe />
            meadow.example
          </span>
          <p>
            A Brooklyn design studio building brands and digital experiences for
            growing teams.
          </p>
          <div class="crm-enrichment-people">
            <span class="crm-contact-avatar">DW</span>
            <span class="crm-contact-avatar">AC</span>
            <span>Dana and Alex</span>
          </div>
        </div>
        <div class="crm-enrichment-details">
          <h4>Company information</h4>
          <dl>
            <For each={companyFacts}>
              {(fact, index) => (
                <div
                  class="crm-enrichment-fact"
                  data-revealed={revealed() > index()}
                >
                  <dt>
                    <fact.icon />
                    {fact.label}
                  </dt>
                  <dd>
                    <Show
                      when={revealed() > index()}
                      fallback={
                        <span
                          class="crm-enrichment-placeholder"
                          aria-label="Looking up company information"
                        />
                      }
                    >
                      <span>{fact.value}</span>
                      <Check aria-hidden="true" />
                    </Show>
                  </dd>
                </div>
              )}
            </For>
          </dl>
          <p class="crm-enrichment-status" role="status">
            <span class="crm-sync-dot" />
            {revealed() === companyFacts.length
              ? 'Company information added'
              : 'Finding company information…'}
          </p>
        </div>
      </div>
    </div>
  );
}
