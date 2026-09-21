import { createContext, useContext } from 'solid-js';

type DriveDetailRouteContextValue = {
  onUnavailable: () => void;
};

export const DriveDetailRouteContext =
  createContext<DriveDetailRouteContextValue>();

export function useMaybeDriveDetailRoute() {
  return useContext(DriveDetailRouteContext);
}
