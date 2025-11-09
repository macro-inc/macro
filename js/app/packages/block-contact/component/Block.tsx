import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { UserIcon } from '@core/component/UserIcon';
import { emailToId } from '@core/user';
import { createMemo, createSignal, Show } from 'solid-js';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import { blockDataSignal } from '../signal/contactBlockData';
import { extractDomainFromEmail, isConsumerEmail } from '../util/emailUtils';
import { ChannelsList } from './ChannelsList';
import { CompanyProfile } from './CompanyProfile';
import { PeopleList } from './PeopleList';
import { SharedFilesSection } from './SharedFilesSection';
import { TopBar } from './TopBar';

export default function BlockContact() {
  const blockData = blockDataSignal.get;
  const [showProfilePreview, setShowProfilePreview] = createSignal(false);
  const { replaceOrInsertSplit } = useSplitLayout();

  const contactData = createMemo(() => {
    const data = blockData();
    if (!data) return null;
    return data;
  });

  const contactType = createMemo(() => contactData()?.type || 'person');

  const userId = createMemo(() => {
    const data = contactData();
    if (!data || data.type !== 'person') return null;
    return emailToId(data.email!);
  });

  const userName = createMemo(() => {
    const data = contactData();
    if (!data) return 'Unknown';
    if (data.type === 'company') return data.domain?.substring(1) || 'Unknown';
    return data.contact?.name || data.email || 'Unknown';
  });

  const userCompany = createMemo(() => {
    const data = contactData();
    if (!data || data.type !== 'person') return 'Unknown';

    const domain = extractDomainFromEmail(data.email!);
    if (isConsumerEmail(domain)) {
      return 'Consumer';
    }

    return domain.charAt(0).toUpperCase() + domain.slice(1);
  });

  const userCompanyDomain = createMemo(() => {
    const data = contactData();
    if (!data || data.type !== 'person') return null;

    const email = data.email!;
    const atIndex = email.lastIndexOf('@');
    if (atIndex === -1) return null;

    const fullDomain = email.substring(atIndex + 1);

    // Check if it's a consumer email domain using the utility function
    // The function checks both with and without .com extension
    const domainName = extractDomainFromEmail(email);
    if (isConsumerEmail(domainName)) {
      return null;
    }

    // Return the full domain for use in navigation
    return fullDomain;
  });

  const title = createMemo(() => {
    const data = contactData();
    if (!data) return 'Contact';
    if (data.type === 'company') {
      return data.unfurlData?.title || data.domain?.substring(1) || 'Company';
    }
    return userName() || 'Contact';
  });

  const emailOrDomain = createMemo(() => {
    const data = contactData();
    if (!data) return '';
    return data.type === 'person' ? data.email! : data.domain!;
  });

  return (
    <DocumentBlockContainer title={title()}>
      <div class="flex flex-col h-full bg-background">
        <TopBar email={emailOrDomain()} type={contactType()} />

        <div class="flex-1 flex flex-col overflow-hidden">
          {/* Top section with contact/company info and shared files */}
          <div class="flex border-b border-edge">
            {/* Contact/Company info section */}
            <div class="p-6 flex-1">
              <Show
                when={contactType() === 'person'}
                fallback={
                  <Show when={contactData()}>
                    {(data) => (
                      <>
                        <CompanyProfile
                          domain={data().domain!}
                          unfurlData={data().unfurlData}
                        />
                        <div class="mt-4">
                          <PeopleList domain={data().domain!} />
                        </div>
                      </>
                    )}
                  </Show>
                }
              >
                <div class="flex gap-6">
                  <div
                    class="w-32 h-32 aspect-square cursor-pointer rounded-lg overflow-hidden"
                    onClick={() => setShowProfilePreview(true)}
                  >
                    <Show
                      when={userId()}
                      fallback={<div class="w-full h-full" />}
                    >
                      <UserIcon id={userId()!} size="fill" isDeleted={false} />
                    </Show>
                  </div>

                  <div class="flex-1 space-y-4">
                    <div class="space-y-2">
                      <div class="flex items-baseline gap-2">
                        <span class="text-sm font-medium text-ink-muted min-w-[60px]">
                          Name:
                        </span>
                        <span class="text-base text-ink truncate flex-1">
                          {userName()}
                        </span>
                      </div>

                      <Show when={contactData()?.email}>
                        <div class="flex items-baseline gap-2">
                          <span class="text-sm font-medium text-ink-muted min-w-[60px]">
                            Email:
                          </span>
                          <span class="text-base text-ink  truncate flex-1">
                            {contactData()!.email}
                          </span>
                        </div>
                      </Show>

                      <div class="flex items-baseline gap-2">
                        <span class="text-sm font-medium text-ink-muted min-w-[60px]">
                          Company:
                        </span>
                        <Show
                          when={userCompanyDomain()}
                          fallback={
                            <span class="text-base text-ink truncate flex-1">
                              {userCompany()}
                            </span>
                          }
                        >
                          <button
                            class="text-base text-accent-ink hover:text-accent-ink-ink hover:underline truncate flex-1 text-left"
                            onClick={() => {
                              const domain = userCompanyDomain();
                              if (domain) {
                                replaceOrInsertSplit({
                                  type: 'contact',
                                  id: `@${domain}`,
                                });
                              }
                            }}
                          >
                            {userCompany()}
                          </button>
                        </Show>
                      </div>

                      <Show when={contactData()?.email}>
                        {(email) => <ChannelsList contactEmail={email()} />}
                      </Show>
                    </div>
                  </div>
                </div>
              </Show>
            </div>

            {/* Shared files section */}
            <Show when={contactType() === 'person' && contactData()?.email}>
              {(email) => (
                <div class="w-[400px] border-l border-edge">
                  <SharedFilesSection contactEmail={email()} />
                </div>
              )}
            </Show>
          </div>
        </div>

        {/* Profile Picture Preview Modal - only for people */}
        <Show when={showProfilePreview() && contactType() === 'person'}>
          <div
            class="fixed inset-0 bg-ink/50 flex items-center justify-center z-50"
            onClick={() => setShowProfilePreview(false)}
          >
            <div class="relative max-w-[75vw] max-h-[90vh]">
              <button
                class="absolute -top-10 right-0 text-panel hover:text-edge"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowProfilePreview(false);
                }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M18 6L6 18M6 6L18 18"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <Show when={userId()}>
                <div class="rounded-lg overflow-hidden">
                  <UserIcon id={userId()!} size="fill" isDeleted={false} />
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </DocumentBlockContainer>
  );
}
