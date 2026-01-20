import { withAnalytics } from '@coparse/analytics';
import { useIsAuthenticated } from '@core/auth';
import { authServiceClient } from '@service-auth/client';
import {
  invalidateUserInfo,
  useGroup,
  useUserId,
} from '@queries/auth/user-info';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { type Component, createEffect, createSignal, Show } from 'solid-js';

const { identify } = withAnalytics();
const useABTestInternal = () => {
  const [ABGroup, setABGroup] = createSignal<'A' | 'B' | undefined>(undefined);
  const userGroup = useGroup();
  const userId = useUserId();
  const authenticated = useIsAuthenticated();

  const setGroup = async (group: 'A' | 'B') => {
    setABGroup(group);
    await authServiceClient.setGroup({ group });
    await invalidateUserInfo();
    const id = userId();
    if (id) {
      identify(id, {
        group,
      });
    }
  };

  createEffect(() => {
    if (!authenticated() || ABGroup() !== undefined) {
      return;
    }
    const existingGroup = userGroup();
    if (existingGroup) {
      setABGroup(existingGroup);
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
