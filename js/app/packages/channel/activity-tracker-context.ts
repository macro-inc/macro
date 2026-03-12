import { createContext, useContext } from 'solid-js';
import type { ActivityTracker } from './activity-tracker';

const ActivityTrackerContext = createContext<ActivityTracker>();

export const ActivityTrackerProvider = ActivityTrackerContext.Provider;

export function useActivityTracker(): ActivityTracker {
  const ctx = useContext(ActivityTrackerContext);
  if (!ctx)
    throw new Error(
      'useActivityTracker must be used within <ActivityTrackerProvider>'
    );
  return ctx;
}
