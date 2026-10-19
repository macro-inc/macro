import { ENABLE_PROFILE_PICTURES } from '@core/constant/featureFlags';
import { staticFileSizedUrl } from '@core/constant/servers';
import { useProfilePictureUrl } from '@core/signal/profilePicture';
import { tryMacroId } from '@core/user/macroId';
import { Show } from 'solid-js';
import { InsightHostAvatar } from '../components/insights-host-filter';
import type { InsightHostOption } from '../core/insight-host-options';

function ProfileHostAvatar(props: { host: InsightHostOption; id: string }) {
  const [url] = useProfilePictureUrl(props.id);
  const photoUrl = () => {
    const value = url();
    return value ? staticFileSizedUrl(value, 'small') : undefined;
  };
  return <InsightHostAvatar host={props.host} photoUrl={photoUrl()} />;
}

export function InsightsHostAvatar(props: { host: InsightHostOption }) {
  return (
    <Show
      keyed
      when={ENABLE_PROFILE_PICTURES && tryMacroId(props.host.value)}
      fallback={<InsightHostAvatar host={props.host} />}
    >
      {(id) => <ProfileHostAvatar host={props.host} id={id} />}
    </Show>
  );
}
