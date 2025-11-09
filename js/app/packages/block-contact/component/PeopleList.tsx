import { createBlockSignal } from '@core/block';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { UserIcon } from '@core/component/UserIcon';
import { type ContactInfo, emailToId } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import { For, onMount, Show } from 'solid-js';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import { emailClient } from '../../service-email/client';

const peopleAtCompanySignal = createBlockSignal<ContactInfo[]>([]);
const isLoadingPeopleSignal = createBlockSignal(false);

export function PeopleList(props: { domain: string }) {
  const peopleAtCompany = peopleAtCompanySignal.get;
  const setPeopleAtCompany = peopleAtCompanySignal.set;
  const isLoadingPeople = isLoadingPeopleSignal.get;
  const setIsLoadingPeople = isLoadingPeopleSignal.set;

  const { replaceOrInsertSplit } = useSplitLayout();

  onMount(async () => {
    await loadPeopleAtCompany();
  });

  async function loadPeopleAtCompany() {
    setIsLoadingPeople(true);

    try {
      // Get the domain without @ prefix
      const domainWithoutAt = props.domain.substring(1);

      // Get all contacts from the email service
      const contactsResult = await emailClient.listContacts();

      if (!isErr(contactsResult)) {
        const [, contactsData] = contactsResult;
        const allContacts: ContactInfo[] = [];

        // Flatten all contacts from the response
        for (const contacts of Object.values(contactsData.contacts)) {
          allContacts.push(...contacts);
        }

        // Filter contacts that have the company domain
        const companyContacts = allContacts.filter((contact) =>
          contact.email
            .toLowerCase()
            .endsWith(`@${domainWithoutAt.toLowerCase()}`)
        );

        // Remove duplicates by email
        const uniqueContacts = Array.from(
          new Map(
            companyContacts.map((c) => [c.email.toLowerCase(), c])
          ).values()
        );

        // Sort by name or email
        uniqueContacts.sort((a, b) => {
          const aName = a.name || a.email;
          const bName = b.name || b.email;
          return aName.localeCompare(bName);
        });

        setPeopleAtCompany(uniqueContacts);
      }
    } catch (error) {
      console.error('Error loading people at company:', error);
    } finally {
      setIsLoadingPeople(false);
    }
  }

  const EmptyState = () => (
    <div class="flex items-center gap-2">
      <span class="text-sm text-ink-extra-muted italic">
        No people found at this company
      </span>
    </div>
  );

  return (
    <div class="space-y-2">
      <div class="flex items-baseline gap-2">
        <span class="text-sm font-medium text-ink-muted min-w-[60px]">
          People:
        </span>
        <Show
          when={!isLoadingPeople()}
          fallback={
            <div class="flex items-center">
              <CircleSpinner width={4} height={4} />
            </div>
          }
        >
          <Show when={peopleAtCompany().length > 0} fallback={<EmptyState />}>
            <div class="flex-1 flex flex-wrap gap-2">
              <For each={peopleAtCompany()}>
                {(person) => {
                  const userId = emailToId(person.email);
                  return (
                    <button
                      class="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-edge/30 hover:bg-hover rounded-md hover-transition-bg"
                      onClick={() =>
                        replaceOrInsertSplit({
                          type: 'contact',
                          id: person.email,
                        })
                      }
                    >
                      <div class="w-5 h-5 overflow-hidden">
                        <UserIcon id={userId} size="fill" isDeleted={false} />
                      </div>
                      <span class="font-medium">
                        {person.name || person.email.split('@')[0]}
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
