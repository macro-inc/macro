import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import RobotIcon from '@icon/system/regular/robot.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import UploadIcon from '@icon/system/regular/upload.svg';
import type { ComputerSize, SizeOffer } from '@service-auth/computers';
import type { CreateTeamAgent } from '@service-auth/team-agents';
import { Avatar, Button, Panel, TextField } from '@ui';
import {
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import { ComputerSizePicker } from '../computers/components/computer-size-picker';
import { formatQuote } from '../computers/core/computer-display';
import { DisabledReason } from '../computers/views/computer-setup-dialog';
import {
  inviteBlocker,
  MAX_AGENT_NAME_CHARS,
  MAX_AGENT_PROFILE_CHARS,
  teamAgentDraftProblems,
  teamAgentRequest,
} from '../core/team-agent-draft';
import { recommendedVoice, type VoicePickerSource } from '../core/voices';
import { VoicePicker } from './voice-picker';

/** Kobalte renders this only while its field is invalid. */
function TooLong(props: { limit: number }) {
  return (
    <TextField.ErrorMessage>
      {t('teamAgents.tooLong', { count: props.limit })}
    </TextField.ErrorMessage>
  );
}

/**
 * Invite an agent teammate: who it is, what it does, and the computer it
 * runs on, priced the way Buy a computer prices it. Renders the body and
 * footer of the Invite to Team panel.
 */
export function InviteAgentForm(props: {
  /** Above the form, e.g. the People | Agent switch. */
  header?: JSX.Element;
  /** Sizes with their price; `undefined` while loading. */
  offers: readonly SizeOffer[] | undefined;
  offersFailed: boolean;
  onRetryOffers: () => void;
  /** The voice catalog; without it the agent gets its template's voice. */
  voices?: VoicePickerSource;
  /** Stores the picture and resolves to its URL. */
  uploadPicture: (file: File) => Promise<string>;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (request: CreateTeamAgent) => void;
}) {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  let pictureInput: HTMLInputElement | undefined;
  // One purchase per dialog: a retry after a failure or timeout reuses it.
  const purchaseKey = crypto.randomUUID();

  const [name, setName] = createSignal('');
  const [jobDescription, setJobDescription] = createSignal('');
  const [personality, setPersonality] = createSignal('');
  const [chosenSize, setChosenSize] = createSignal<ComputerSize>();
  const [avatarUrl, setAvatarUrl] = createSignal<string>();
  const [uploading, setUploading] = createSignal(false);
  const [pictureFailed, setPictureFailed] = createSignal(false);
  // Until the admin picks one, the voice that suits the personality.
  const [chosenVoice, setChosenVoice] = createSignal<string>();
  const voice = () =>
    chosenVoice() ??
    recommendedVoice(props.voices?.choices() ?? [], personality())?.model;

  // Until the admin picks one, the first size that is for sale.
  const size = () =>
    chosenSize() ?? props.offers?.find((offer) => !offer.soldOut)?.size;
  const offer = () =>
    props.offers?.find((item) => item.size === size() && !item.soldOut);

  const draft = () => ({
    name: name(),
    jobDescription: jobDescription(),
    personality: personality(),
    size: offer()?.size,
    avatarUrl: avatarUrl(),
    voice: voice(),
    purchaseKey,
  });
  const problems = () => teamAgentDraftProblems(draft());
  const busy = () => props.pending || uploading();
  // Why Invite agent can't be pressed, beside it, as the computer flow does.
  const disabledReason = () => {
    if (props.pending) return undefined;
    if (uploading()) return t('teamAgents.waitForPicture');
    const blocker = inviteBlocker(problems());
    if (!blocker) return undefined;
    return match(blocker)
      .with('fields', () => t('teamAgents.fillRequired'))
      .with('too_long', () => t('teamAgents.shortenFields'))
      .with('size', () =>
        props.offers
          ? t('teamAgents.noSizeForSale')
          : t('teamAgents.loadingSizes')
      )
      .exhaustive();
  };

  // The error sits at the end of a long form; bring it into view and
  // announce it, so pressing Invite agent never looks like nothing happened.
  let errorLine: HTMLParagraphElement | undefined;
  createEffect(() => {
    if (!props.error || !errorLine) return;
    errorLine.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    errorLine.focus({ preventScroll: true });
  });

  const inviteLabel = () => {
    const chosen = offer();
    if (!chosen || chosen.quote.amount === 0) return t('teamAgents.invite');
    return t('teamAgents.invitePriced', { price: formatQuote(chosen.quote) });
  };

  const submit = () => {
    const request = teamAgentRequest(draft());
    if (busy() || !request) return;
    // A retry after a failure sends the same voice, even if the suggestion moves.
    if (request.voice) setChosenVoice(request.voice);
    props.onSubmit(request);
  };

  const upload = async (file: File) => {
    setUploading(true);
    setPictureFailed(false);
    try {
      const url = await props.uploadPicture(file);
      if (!disposed) setAvatarUrl(url);
    } catch {
      if (!disposed) setPictureFailed(true);
    } finally {
      if (!disposed) setUploading(false);
    }
  };

  return (
    <>
      <Panel.Body scroll>
        <div class="flex flex-col gap-5 px-5 py-5">
          {props.header}
          <p class="text-sm text-ink-muted">{t('teamAgents.intro')}</p>

          <div class="flex items-center gap-3">
            <Avatar
              size="lg"
              class="bg-surface text-accent ring ring-edge-muted"
            >
              <Show
                when={avatarUrl()}
                fallback={
                  <Avatar.Fallback>
                    <RobotIcon class="size-5" />
                  </Avatar.Fallback>
                }
              >
                {(url) => <Avatar.Image src={url()} alt="" />}
              </Show>
            </Avatar>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-ink">
                {t('teamAgents.picture')}
              </div>
              <div class="mt-0.5 text-xs text-ink-muted">
                <Show
                  when={pictureFailed()}
                  fallback={t('teamAgents.pictureHint')}
                >
                  <span role="alert" class="text-failure">
                    {t('teamAgents.pictureFailed')}
                  </span>
                </Show>
              </div>
            </div>
            <input
              ref={pictureInput}
              type="file"
              accept="image/*"
              class="hidden"
              aria-label={t('teamAgents.uploadPicture')}
              disabled={busy()}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) fireAndForget(upload(file), 'team-agent.picture');
              }}
            />
            <Show when={avatarUrl() && !uploading()}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy()}
                onClick={() => setAvatarUrl(undefined)}
              >
                {t('teamAgents.removePicture')}
              </Button>
            </Show>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy()}
              onClick={() => pictureInput?.click()}
            >
              <UploadIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
              {uploading() ? t('teamAgents.uploading') : t('teamAgents.upload')}
            </Button>
          </div>

          <TextField
            value={name()}
            onChange={setName}
            disabled={props.pending}
            validationState={
              problems().name === 'too_long' ? 'invalid' : 'valid'
            }
          >
            <TextField.Label>{t('teamAgents.name')}</TextField.Label>
            <TextField.Input
              placeholder={t('teamAgents.namePlaceholder')}
              required
            />
            <TooLong limit={MAX_AGENT_NAME_CHARS} />
          </TextField>

          <TextField
            value={jobDescription()}
            onChange={setJobDescription}
            disabled={props.pending}
            validationState={
              problems().jobDescription === 'too_long' ? 'invalid' : 'valid'
            }
          >
            <TextField.Label>{t('teamAgents.jobDescription')}</TextField.Label>
            <TextField.TextArea
              placeholder={t('teamAgents.jobDescriptionPlaceholder')}
              required
            />
            <TooLong limit={MAX_AGENT_PROFILE_CHARS} />
          </TextField>

          <TextField
            value={personality()}
            onChange={setPersonality}
            disabled={props.pending}
            validationState={
              problems().personality === 'too_long' ? 'invalid' : 'valid'
            }
          >
            <TextField.Label>{t('teamAgents.personality')}</TextField.Label>
            <TextField.TextArea
              placeholder={t('teamAgents.personalityPlaceholder')}
              required
            />
            <TooLong limit={MAX_AGENT_PROFILE_CHARS} />
          </TextField>

          <Show when={props.voices}>
            {(source) => (
              <div class="flex flex-col gap-1">
                <VoicePicker
                  source={source()}
                  value={voice()}
                  onChange={setChosenVoice}
                  disabled={props.pending}
                />
                <p class="text-xs text-ink-muted">
                  {t('teamAgents.voiceHint')}
                </p>
              </div>
            )}
          </Show>

          <div class="flex flex-col gap-2">
            <div class="text-sm font-medium text-ink">
              {t('teamAgents.computer')}
            </div>
            <p class="text-xs text-ink-muted">{t('teamAgents.computerHint')}</p>
            <Show
              when={props.offers}
              fallback={
                <Show
                  when={props.offersFailed}
                  fallback={
                    <p role="status" class="text-sm text-ink-muted">
                      {t('teamAgents.loadingSizes')}
                    </p>
                  }
                >
                  <div
                    role="alert"
                    class="flex flex-wrap items-center gap-2 text-sm text-ink-muted"
                  >
                    <span>{t('teamAgents.sizesFailed')}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => props.onRetryOffers()}
                    >
                      {t('teamAgents.tryAgain')}
                    </Button>
                  </div>
                </Show>
              }
            >
              {(offers) => (
                <ComputerSizePicker
                  offers={offers()}
                  selected={size()}
                  onSelect={setChosenSize}
                />
              )}
            </Show>
            <p class="text-xs text-ink-muted">
              {t('settingsBilling.proration')}
            </p>
          </div>

          <Show when={props.error}>
            {(error) => (
              <p
                ref={errorLine}
                role="alert"
                tabIndex={-1}
                data-invite-error
                class="text-sm text-failure outline-none"
              >
                {error()}
              </p>
            )}
          </Show>
        </div>
      </Panel.Body>
      <Panel.Footer class="flex-wrap justify-end gap-2 px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          disabled={props.pending}
          onClick={() => props.onCancel()}
        >
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={busy() || !teamAgentRequest(draft())}
          onClick={submit}
        >
          <Show when={props.pending} fallback={inviteLabel()}>
            <SpinnerIcon class="size-4 animate-spin" />
            <span class="sr-only">{t('teamAgents.inviting')}</span>
          </Show>
        </Button>
        <Show when={disabledReason()}>
          {(reason) => <DisabledReason>{reason()}</DisabledReason>}
        </Show>
      </Panel.Footer>
    </>
  );
}
