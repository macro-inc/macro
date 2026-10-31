import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
import X from '@icon/system/regular/x.svg';
import { ActionDialogShell, Button, Dialog, Input } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import {
  type AttentionReason,
  type Campaign,
  type Enrollment,
  type MarketingContact,
  newId,
  planSteps,
} from '../core/model';
import { ContactEnrollments } from './contact-enrollments';
import { errorMessage } from './error-message';
import { OptionSelect } from './option-select';

export type Template = 'welcome' | 'blank';

function DialogHeader(props: {
  title: JSX.Element;
  description?: JSX.Element;
}) {
  return (
    <div class="flex shrink-0 items-start justify-between gap-3 border-b border-edge-divider px-5 py-4">
      <div class="min-w-0">
        <ActionDialogShell.Title class="truncate">
          {props.title}
        </ActionDialogShell.Title>
        <Show when={props.description}>
          <ActionDialogShell.Description class="mt-1 truncate">
            {props.description}
          </ActionDialogShell.Description>
        </Show>
      </div>
      {/* Phone drawers dismiss by drag, backdrop, or Escape; no X. */}
      <Show when={!isMobile()}>
        <Dialog.CloseButton
          as={Button}
          variant="ghost"
          size="icon-sm"
          aria-label={t('emailMarketing.close')}
        >
          <X aria-hidden="true" class="size-4" />
        </Dialog.CloseButton>
      </Show>
    </div>
  );
}

export function NewCampaignDialog(props: {
  open: boolean;
  busy: boolean;
  error: unknown;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onCreate: (name: string, template: Template) => void;
}) {
  const [name, setName] = createSignal('');
  const [template, setTemplate] = createSignal<Template>('welcome');
  return (
    <Dialog
      open={props.open}
      position="center"
      class="w-[min(480px,calc(100vw-16px))]"
      onOpenChange={(open) => {
        if (!props.busy) props.onOpenChange(open);
      }}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      <ActionDialogShell>
        <form
          class="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (name().trim() && !props.busy)
              props.onCreate(name().trim(), template());
          }}
        >
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>
                {t('emailMarketing.createCampaign')}
              </ActionDialogShell.Title>
              <ActionDialogShell.Description>
                {t('emailMarketing.createCampaignHint')}
              </ActionDialogShell.Description>
            </ActionDialogShell.Header>
            <label class="block space-y-2 text-xs font-medium">
              {t('emailMarketing.campaignName')}
              <Input
                aria-label={t('emailMarketing.campaignName')}
                value={name()}
                required
                maxLength={120}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <div class="space-y-2 text-xs font-medium">
              <span>{t('emailMarketing.startingPoint')}</span>
              <OptionSelect<Template>
                label={t('emailMarketing.startingPoint')}
                value={template()}
                options={[
                  {
                    value: 'welcome',
                    label: t('emailMarketing.templateWelcome'),
                  },
                  { value: 'blank', label: t('emailMarketing.templateBlank') },
                ]}
                onChange={setTemplate}
              />
            </div>
            <Show when={props.error}>
              {(cause) => (
                <p class="text-xs text-failure" role="alert">
                  {errorMessage(cause())}
                </p>
              )}
            </Show>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button
              type="button"
              variant="ghost"
              disabled={props.busy}
              onClick={() => props.onOpenChange(false)}
            >
              {t('emailMarketing.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={props.busy}
              disabled={!name().trim() || props.busy}
            >
              {t('emailMarketing.createCampaign')}
            </Button>
          </ActionDialogShell.Footer>
        </form>
      </ActionDialogShell>
    </Dialog>
  );
}

/** Seed steps for a new campaign, written in the interface language. */
export function templateSteps(template: Template) {
  const step = (
    delayDays: number,
    subject: string,
    body: string,
    asReply?: boolean
  ) => ({ id: newId(), delayDays, subject, body, asReply });
  return template === 'welcome'
    ? [
        step(
          0,
          t('emailMarketing.welcomeSubject', { tag: '{{firstName}}' }),
          t('emailMarketing.welcomeBody', { tag: '{{firstName}}' })
        ),
        step(
          2,
          '',
          t('emailMarketing.welcomeFollowUpBody', { tag: '{{firstName}}' }),
          true
        ),
      ]
    : [step(0, '', '')];
}

const SAMPLE_CONTACT: MarketingContact = {
  email: 'alex@example.com',
  name: 'Alex Morgan',
};

export function PreviewDialog(props: {
  campaign: Campaign;
  stepIndex: number | undefined;
  contacts: MarketingContact[];
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [email, setEmail] = createSignal<string>();
  const contact = () =>
    props.contacts.find((item) => item.email === email()) ??
    props.contacts[0] ??
    SAMPLE_CONTACT;
  /** The step exactly as enrolling would send it to this contact. */
  const planned = () =>
    props.stepIndex === undefined
      ? undefined
      : planSteps(props.campaign, contact(), new Date())[props.stepIndex];
  return (
    <Dialog
      open={props.stepIndex !== undefined}
      position="center"
      class="w-[min(650px,calc(100vw-16px))]"
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      <ActionDialogShell class="max-h-[88vh]">
        <DialogHeader
          title={t('emailMarketing.emailPreview')}
          description={t('emailMarketing.emailPreviewHint')}
        />
        <ActionDialogShell.Body>
          <OptionSelect
            label={t('emailMarketing.previewContact')}
            value={contact().email}
            options={
              props.contacts.length
                ? props.contacts.map((item) => ({
                    value: item.email,
                    label: item.name || item.email,
                  }))
                : [
                    {
                      value: SAMPLE_CONTACT.email,
                      label: t('emailMarketing.sampleContact', {
                        name: SAMPLE_CONTACT.name,
                      }),
                    },
                  ]
            }
            personal
            onChange={setEmail}
          />
          <div class="ph-no-capture overflow-hidden rounded-xl border border-edge-muted">
            <div class="space-y-2 border-b border-edge-muted p-5">
              <p class="text-xs text-ink-muted">
                {t('emailMarketing.previewTo', { email: contact().email })}
              </p>
              <p class="text-sm font-semibold">{planned()?.subject}</p>
            </div>
            <div class="whitespace-pre-wrap p-6 text-sm leading-7">
              {planned()?.body}
            </div>
          </div>
        </ActionDialogShell.Body>
      </ActionDialogShell>
    </Dialog>
  );
}

export function ContactDialog(props: {
  contact: MarketingContact | undefined;
  entries: Enrollment[];
  unsubscribed: boolean;
  disabled: boolean;
  attention: (entry: Enrollment) => AttentionReason | undefined;
  sentSteps: (entry: Enrollment) => number;
  isFinished: (entry: Enrollment) => boolean;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  onOpenCrm: (contact: MarketingContact) => void;
  onUnsubscribe: (contact: MarketingContact) => void;
}) {
  return (
    <Dialog
      open={!!props.contact}
      position="center"
      class="w-[min(520px,calc(100vw-16px))]"
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      <ActionDialogShell>
        <DialogHeader
          title={
            <span class="ph-no-capture">
              {props.contact?.name || props.contact?.email}
            </span>
          }
          description={
            <span class="ph-no-capture">{props.contact?.email}</span>
          }
        />
        <ActionDialogShell.Body>
          <ContactEnrollments
            entries={props.entries}
            unsubscribed={props.unsubscribed}
            attention={props.attention}
            sentSteps={props.sentSteps}
            isFinished={props.isFinished}
          />
          <div class="flex flex-wrap gap-2">
            <Show when={props.contact?.crmContactId}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => props.onOpenCrm(props.contact!)}
              >
                {t('emailMarketing.openCrmContact')}
              </Button>
            </Show>
            <Show when={!props.unsubscribed}>
              <Button
                type="button"
                variant="ghost"
                disabled={props.disabled}
                onClick={() => props.onUnsubscribe(props.contact!)}
              >
                {t('emailMarketing.markUnsubscribed')}
              </Button>
            </Show>
          </div>
        </ActionDialogShell.Body>
      </ActionDialogShell>
    </Dialog>
  );
}
