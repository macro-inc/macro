import { withAnalytics } from '@coparse/analytics';
import { useIsAuthenticated } from '@core/auth';
import { isErr } from '@core/util/maybeResult';
import {
  gqlServiceClient,
  updateUserInfo,
  useUserInfo,
} from '@service-gql/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { type Component, createEffect, createSignal, Show } from 'solid-js';

const { identify } = withAnalytics();
const useABTestInternal = () => {
  const [ABGroup, setABGroup] = createSignal<'A' | 'B' | undefined>(undefined);
  const [userInfo] = useUserInfo();
  const authenticated = useIsAuthenticated();

  const setGroup = async (group: 'A' | 'B') => {
    setABGroup(group);
    await gqlServiceClient.setGroup({ group });
    gqlServiceClient.getUserInfo.invalidate();
    const userInfoResult = await updateUserInfo();
    if (!userInfoResult || isErr(userInfoResult)) return;
    const userInfo = userInfoResult[1];
    if (userInfo.id) {
      identify(userInfo.id, {
        group,
      });
    }
  };

  createEffect(() => {
    if (
      !authenticated() ||
      (userInfo() && isErr(userInfo())) ||
      ABGroup() !== undefined
    ) {
      return;
    }
    const userInfoResult = userInfo()[1];
    if (userInfoResult?.group) {
      setABGroup(userInfoResult?.group);
    } else {
      const randomGroup = Math.random() < 0.5 ? 'A' : 'B';
      setGroup(randomGroup);
    }
  });

  return {
    ABGroup,
    ShowAB: (props: { control: Component; variant: Component }) => (
      <>
        <Show when={ABGroup() === 'A'}>{props.control}</Show>
        <Show when={ABGroup() === 'B'}>{props.variant}</Show>
      </>
    ),
  };
};

export const useABTest = createSingletonRoot(useABTestInternal);
