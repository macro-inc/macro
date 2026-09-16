import type { DriveState } from '../core/types';

export type DriveSelection = Pick<DriveState, 'location' | 'scope' | 'sort'>;

export type DriveResults = {
  apply: (selection: DriveSelection, clearSearch: boolean) => void;
};
