import { withAnalytics } from '@coparse/analytics';
import { isErr } from '@core/util/maybeResult';
import type { IOrganizationSettings } from '@service-organization/client';
import { organizationServiceClient } from '@service-organization/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createEffect, createResource, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';

const { track, TrackingEvents } = withAnalytics();

const useOrganizationSettings = createSingletonRoot(() => {
  const [loading, setLoading] = createSignal(true);
  const [store, setStore] = createStore<IOrganizationSettings>({
    name: '',
    default_share_permission: 'public',
  });

  const [getOrgSettings] = createResource(
    organizationServiceClient.getOrganizationSettings
  );

  createEffect(() => {
    const orgSettings = getOrgSettings();
    if (!orgSettings || isErr(orgSettings)) return;
    const [_, data] = orgSettings;
    setStore({
      ...data,
      default_share_permission: data.default_share_permission || 'public',
    });
    setLoading(false);
  });

  const changeSharePermissions = async (e: Event) => {
    const target = e.target as HTMLSelectElement;
    if (!target) return;
    const share_type = target.value as 'public' | 'private' | 'organization';

    try {
      const data =
        await organizationServiceClient.updateSharePermissions(share_type);
      if (isErr(data)) {
        throw new Error('Failed to update share permissions');
      }
      setStore('default_share_permission', share_type);
      track(TrackingEvents.ORGANIZATION.SETTINGS.PERMISSIONS, {
        plubic: target.value === 'public',
      });
    } catch (e) {
      console.error(e);
      return;
    }
  };

  // const changePublicAccessLevel = async (e: Event) => {
  //   const target = e.target as HTMLSelectElement;
  //   if (!target) return;
  //   const update = {
  //     default_share_permission: {
  //       is_public: store.default_share_permission?.is_public || false,
  //       public_access_level: target.value as 'owner' | 'edit' | 'view',
  //     },
  //   };

  //   try {
  //     const data =
  //       await organizationServiceClient.patchOrganizationSettings(update);
  //     if (isErr(data)) {
  //       throw new Error('Failed to update public access level');
  //     }
  //     setStore('default_share_permission', {
  //       ...store.default_share_permission,
  //       public_access_level: target.value as 'owner' | 'edit' | 'view',
  //     });
  //     track(TrackingEvents.ORGANIZATION.SETTINGS.ACCESSLEVEL, {
  //       level: target.value,
  //     });
  //   } catch (e) {
  //     console.error(e);
  //     return;
  //   }
  // };

  const updateRetentionDays = async (days: number) => {
    const update = { retention_days: days };

    try {
      const data =
        await organizationServiceClient.patchOrganizationSettings(update);
      if (isErr(data)) {
        throw new Error('Failed to update retention days');
      }
      setStore('retention_days', days);
      track(TrackingEvents.ORGANIZATION.SETTINGS.RETENTION, {
        days: days,
      });
    } catch (e) {
      console.error(e);
      return;
    }
  };

  const changeRetentionDays = async (e: Event) => {
    const target = e.target as HTMLSelectElement;
    if (!target) return;
    const days = parseInt(target.value);

    updateRetentionDays(days);
  };

  const removeRetentionDays = async () => {
    const update = {
      remove_retention_days: true,
    };

    try {
      const data =
        await organizationServiceClient.patchOrganizationSettings(update);
      if (isErr(data)) {
        throw new Error('Failed to remove retention days');
      }

      setStore('retention_days', undefined);
      track(TrackingEvents.ORGANIZATION.SETTINGS.RETENTION, {
        days: null,
      });
    } catch (e) {
      console.error(e);
      return;
    }
  };

  return {
    orgSettings: store,
    loading,
    changeSharePermissions,
    // changePublicAccessLevel,
    changeRetentionDays,
    updateRetentionDays,
    removeRetentionDays,
  };
});

export default useOrganizationSettings;
