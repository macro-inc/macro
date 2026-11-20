import { t } from '@app/lib/i18n';
import {
  dockShowsTeamLogo,
  setDockShowsTeamLogo,
} from '@components/app/dock-prefs';
import { toast } from '@core/component/Toast/Toast';
import { staticFileSizedEndpoint } from '@core/constant/servers';
import { createStaticFile } from '@core/util/create';
import { openFilePicker } from '@core/util/upload';
import PlusIcon from '@icon/system/regular/plus.svg';
import { queryReadyGate } from '@queries/gate';
import {
  useCurrentTeamQuery,
  useIsTeamAdmin,
  usePatchTeamMutation,
} from '@queries/team/teams';
import { Button, cn, ToggleSwitch } from '@ui';
import { ResultAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { SettingsCard, SettingsRow, SettingsSection } from './primitives';

/** The image types the backend accepts as a team logo. SVG is excluded. */
const TEAM_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const TEAM_LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

/** The largest logo the backend's static file storage accepts here. */
const MAX_TEAM_LOGO_BYTES = 16 * 1000 * 1000;

/** The logo, or + when there is none, at the size the dock shows it. */
function TeamLogoPreview(props: { fileId: string | undefined }) {
  return (
    <span class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-edge-muted bg-page">
      <Show
        when={props.fileId}
        fallback={<PlusIcon class="size-5 text-ink-muted" />}
      >
        {(id) => (
          <img
            src={staticFileSizedEndpoint(id(), 'small')}
            alt={t('settingsDock.teamLogoAlt')}
            class="size-10 object-contain"
          />
        )}
      </Show>
    </span>
  );
}

/**
 * Settings → Dock → Team logo. A team admin uploads or removes the image that
 * replaces + on every member's dock; members see it read-only; anyone can show
 * + on their own dock instead. Without a team the section is shown disabled.
 */
export function TeamLogoSettings() {
  const teamQuery = useCurrentTeamQuery();
  const isTeamAdmin = useIsTeamAdmin();
  const patchTeam = usePatchTeamMutation();
  const [uploading, setUploading] = createSignal(false);

  // Undefined while the team loads, so nothing claims "no team" too early.
  const team = () => (queryReadyGate(teamQuery) ? teamQuery.data : undefined);
  const hasNoTeam = () => queryReadyGate(teamQuery) && teamQuery.data === null;
  const logoFileId = () => team()?.team.logo_file_id ?? undefined;
  const canEdit = () => {
    const current = team();
    return (
      current !== undefined && current !== null && isTeamAdmin(current.team.id)
    );
  };
  const busy = () => uploading() || patchTeam.isPending;

  const setLogo = (teamId: string, fileId: string | null) =>
    patchTeam.mutate({ teamId, request: { logo_file_id: fileId } });

  const uploadLogo = async (files: File[]) => {
    const file = files[0];
    const teamId = team()?.team.id;
    if (!file || !teamId) return;

    if (!TEAM_LOGO_TYPES.includes(file.type)) {
      toast.failure(t('settingsDock.teamLogoWrongType'));
      return;
    }
    if (file.size > MAX_TEAM_LOGO_BYTES) {
      toast.failure(t('settingsDock.teamLogoTooLarge'));
      return;
    }

    setUploading(true);
    const uploaded = await ResultAsync.fromPromise(
      createStaticFile(file),
      (error) => error
    );
    setUploading(false);

    if (uploaded.isErr()) {
      console.error('Failed to upload team logo', uploaded.error);
      toast.failure(t('settingsDock.teamLogoUploadFailed'));
      return;
    }

    // The team can change while the upload runs; only set the logo on the
    // team it was chosen for.
    if (team()?.team.id !== teamId) return;
    setLogo(teamId, uploaded.value);
  };

  const pickLogo = () =>
    openFilePicker(
      {
        acceptedMimeTypes: TEAM_LOGO_TYPES,
        acceptedFileExtensions: TEAM_LOGO_EXTENSIONS,
      },
      uploadLogo
    );

  const removeLogo = () => {
    const teamId = team()?.team.id;
    if (!teamId) return;
    setLogo(teamId, null);
  };

  const uploadLabel = () => {
    if (uploading()) return t('settingsDock.teamLogoUploading');
    if (logoFileId()) return t('settingsDock.teamLogoReplace');
    return t('settingsDock.teamLogoUpload');
  };

  const logoDescription = () => {
    if (hasNoTeam()) return t('settingsDock.teamLogoNeedsTeam');
    if (team() && !canEdit()) return t('settingsDock.teamLogoAdminsOnly');
    return t('settingsDock.teamLogoDescription');
  };

  return (
    <SettingsSection
      title={t('settingsDock.teamLogoTitle')}
      target="Team logo"
      description={t('settingsDock.teamLogoSectionDescription')}
    >
      <div
        aria-disabled={hasNoTeam() ? 'true' : undefined}
        class={cn(hasNoTeam() && 'opacity-50')}
      >
        <SettingsCard>
          <SettingsRow
            label={t('settingsDock.teamLogoLabel')}
            description={logoDescription()}
            muted={hasNoTeam()}
          >
            <TeamLogoPreview fileId={logoFileId()} />
            <Show when={canEdit()}>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy()}
                onClick={pickLogo}
              >
                {uploadLabel()}
              </Button>
              <Show when={logoFileId()}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy()}
                  onClick={removeLogo}
                >
                  {t('settingsDock.teamLogoRemove')}
                </Button>
              </Show>
            </Show>
          </SettingsRow>
          <SettingsRow
            label={t('settingsDock.showTeamLogoLabel')}
            description={t('settingsDock.showTeamLogoDescription')}
            muted={hasNoTeam() || !logoFileId()}
          >
            <ToggleSwitch
              size="md"
              aria-label={t('settingsDock.showTeamLogoLabel')}
              checked={dockShowsTeamLogo()}
              onChange={setDockShowsTeamLogo}
              disabled={!logoFileId()}
            />
          </SettingsRow>
        </SettingsCard>
      </div>
    </SettingsSection>
  );
}
