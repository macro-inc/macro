import ArrowLeft from '@phosphor/arrow-left.svg';
import Buildings from '@phosphor/buildings.svg';
import Link from '@phosphor/link.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  type HomepagePersonId,
  homepagePeople,
} from '../../core/homepage-demo-people';
import { type DealStage, dealStages } from '../../core/workspace-fixtures';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewShell } from '../DemoWorkspaceChrome';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { SearchBar } from '../email/frozen/SearchBar';
import {
  DetailLayout,
  PanelGrid,
  PanelRow,
  PanelSection,
  PanelToggle,
} from './frozen/DetailPanel';
import { MessageRow } from './frozen/MessageRow';

export function WorkspaceCompanies(props: {
  workspace: DummyWorkspace;
  initialPanelOpen?: boolean;
}) {
  const w = props.workspace;
  const selected = () => w.data.companies.find((c) => c.id === w.selected());
  const [panel, setPanel] = createSignal<boolean | undefined>(
    props.initialPanelOpen
  );
  const [contactSearch, setContactSearch] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const companies = () =>
    w.data.companies.filter(
      (c) =>
        `${c.name} ${c.domain}`
          .toLowerCase()
          .includes(w.query().toLowerCase()) &&
        (w.companyFilter() !== 'My companies' || c.owner === 'jacob') &&
        (w.companyFilter() !== 'Unassigned' || !c.owner) &&
        (w.companyFilter() !== 'Needs follow-up' || c.stage === 'Lead')
    );
  const update = (patch: Partial<NonNullable<ReturnType<typeof selected>>>) =>
    w.setData('companies', (c) => c.id === w.selected(), patch);
  return (
    <Show
      when={selected()}
      fallback={
        <>
          <ViewShell.TopBar>
            <span class="text-sm font-medium">{w.companyFilter()}</span>
          </ViewShell.TopBar>
          <div class="p-4">
            <SearchBar
              label="Search companies"
              placeholder="Search companies"
              value={w.query()}
              onValueChange={w.setQuery}
              class="max-w-md"
            />
          </div>
          <Show
            when={w.companyLayout() === 'Board'}
            fallback={
              <div class="dummy-scroll p-3">
                <For each={companies()}>
                  {(c) => (
                    <button
                      class="sample-company-list"
                      type="button"
                      onClick={() => w.open('crm', c.id)}
                    >
                      <Buildings class="size-4" />
                      <span>{c.name}</span>
                      <span class="ml-auto text-ink-muted">{c.domain}</span>
                      <span class="w-24 text-right text-xs">{c.stage}</span>
                    </button>
                  )}
                </For>
              </div>
            }
          >
            <div class="sample-company-board">
              <For each={dealStages}>
                {(stage) => (
                  <section
                    aria-label={stage}
                    class="sample-company-column"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer?.getData('text/plain');
                      if (id)
                        w.setData(
                          'companies',
                          (c) => c.id === id,
                          'stage',
                          stage
                        );
                    }}
                  >
                    <h3>
                      <span class="sample-stage-dot" data-stage={stage} />
                      {stage}
                    </h3>
                    <For each={companies().filter((c) => c.stage === stage)}>
                      {(c) => (
                        <button
                          draggable
                          onDragStart={(e) =>
                            e.dataTransfer?.setData('text/plain', c.id)
                          }
                          type="button"
                          class="sample-company-card"
                          onClick={() => w.open('crm', c.id)}
                        >
                          <span class="flex gap-2 items-center">
                            <Buildings class="size-4 shrink-0" />
                            <strong class="truncate">{c.name}</strong>
                          </span>
                          <span class="flex gap-2 text-xs text-ink-extra-muted">
                            <span class="truncate">{c.domain}</span>
                            <span class="ml-auto shrink-0">9:41 AM</span>
                          </span>
                        </button>
                      )}
                    </For>
                  </section>
                )}
              </For>
            </div>
          </Show>
        </>
      }
    >
      {(company) => (
        <>
          <ViewShell.TopBar>
            <Button
              size="icon-sm"
              variant="plain"
              label="Back to companies"
              onClick={() => w.open('crm')}
            >
              <ArrowLeft />
            </Button>
            <span class="text-sm text-ink-muted">All companies</span>
            <span>›</span>
            <Buildings class="size-4" />
            <span class="truncate text-sm">{company().name}</span>
            <Button
              class="ml-auto"
              size="sm"
              variant="plain"
              onClick={async () => {
                await navigator.clipboard.writeText(
                  `${location.origin}/demo#company-${company().id}`
                );
                setCopied(true);
              }}
            >
              <Link />
              {copied() ? 'Copied' : 'Copy link'}
            </Button>
            <PanelToggle open={panel()} onChange={setPanel} />
          </ViewShell.TopBar>
          <DetailLayout
            open={panel()}
            panel={
              <>
                <PanelSection title="Details" open>
                  <p class="text-xs text-ink-muted">Domains</p>
                  <input
                    aria-label="Company domain"
                    class="sample-inline-input"
                    value={company().domain}
                    onInput={(e) => update({ domain: e.currentTarget.value })}
                  />
                  <p class="text-xs text-ink-muted mt-3">Last interaction</p>
                  <p>Today, 9:41 AM</p>
                </PanelSection>
                <PanelSection title="Properties" open>
                  <PanelGrid>
                    <PanelRow label="Deal Stage">
                      <select
                        aria-label="Deal stage"
                        value={company().stage}
                        onChange={(e) =>
                          update({ stage: e.currentTarget.value as DealStage })
                        }
                      >
                        <For each={dealStages}>
                          {(stage) => <option>{stage}</option>}
                        </For>
                      </select>
                    </PanelRow>
                    <PanelRow label="Owner">
                      <select
                        aria-label="Company owner"
                        value={company().owner}
                        onChange={(e) =>
                          update({
                            owner: e.currentTarget.value as
                              | HomepagePersonId
                              | '',
                          })
                        }
                      >
                        <option value="">Unassigned</option>
                        <For each={['jacob', 'julia', 'teo'] as const}>
                          {(id) => (
                            <option value={id}>
                              {homepagePeople[id].shortName}
                            </option>
                          )}
                        </For>
                      </select>
                    </PanelRow>
                    <PanelRow label="Revenue">
                      <input
                        aria-label="Revenue"
                        class="sample-inline-input"
                        placeholder="Empty"
                        value={company().revenue}
                        onInput={(e) =>
                          update({ revenue: e.currentTarget.value })
                        }
                      />
                    </PanelRow>
                  </PanelGrid>
                </PanelSection>
                <PanelSection title="Contacts" open>
                  <input
                    class="sample-inline-input sample-contact-search"
                    aria-label="Search contacts"
                    placeholder="Search contacts…"
                    value={contactSearch()}
                    onInput={(e) => setContactSearch(e.currentTarget.value)}
                  />
                  <For
                    each={company().contacts.filter((c) =>
                      `${c.name} ${c.email}`
                        .toLowerCase()
                        .includes(contactSearch().toLowerCase())
                    )}
                  >
                    {(contact) => (
                      <div class="py-2">
                        <p>{contact.name}</p>
                        <p class="text-xs text-ink-muted">{contact.email}</p>
                      </div>
                    )}
                  </For>
                </PanelSection>
                <PanelSection title="Sharing">
                  <p class="text-xs text-ink-muted">
                    Visible to your sample workspace.
                  </p>
                </PanelSection>
              </>
            }
          >
            <div class="dummy-scroll">
              <div class="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 px-6 pt-12 pb-12">
                <div class="flex items-start gap-3">
                  <Buildings class="size-10 shrink-0 text-ink-muted" />
                  <div class="min-w-0 flex-1">
                    <input
                      class="sample-inline-input text-xl font-semibold"
                      aria-label="Company name"
                      value={company().name}
                      onInput={(e) => update({ name: e.currentTarget.value })}
                    />
                    <textarea
                      class="sample-inline-input resize-none text-sm text-ink-muted"
                      aria-label="Company description"
                      value={company().description}
                      onInput={(e) =>
                        update({ description: e.currentTarget.value })
                      }
                    />
                  </div>
                </div>
                <details open class="sample-discussion">
                  <summary>Discussion</summary>
                  <For each={company().comments}>
                    {(comment) => <MessageRow message={comment} />}
                  </For>
                  <ChannelComposer
                    label="Comment on company"
                    placeholder="Leave a comment…"
                    onSend={(body) =>
                      update({
                        comments: [
                          ...company().comments,
                          {
                            id: crypto.randomUUID(),
                            person: 'jacob',
                            body,
                            time: 'Now',
                          },
                        ],
                      })
                    }
                  />
                </details>
                <section class="mt-12">
                  <h2 class="text-sm mb-6">Emails</h2>
                  <For
                    each={w.data.emails.filter((e) =>
                      company().emailIds.includes(e.id)
                    )}
                    fallback={
                      <p class="text-sm text-ink-muted text-center py-8">
                        No email conversations yet.
                      </p>
                    }
                  >
                    {(email) => (
                      <button
                        type="button"
                        class="sample-company-list"
                        onClick={() => w.open('email', email.id)}
                      >
                        <span>{email.sender}</span>
                        <span class="truncate">{email.subject}</span>
                        <span class="ml-auto text-xs text-ink-muted">
                          {email.time}
                        </span>
                      </button>
                    )}
                  </For>
                </section>
              </div>
            </div>
          </DetailLayout>
        </>
      )}
    </Show>
  );
}
