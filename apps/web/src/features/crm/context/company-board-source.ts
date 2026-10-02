import type { Accessor } from 'solid-js';
import type { DealStage } from '../core/stages';

export type CompanyBoardSource<T extends { id: string }> = {
  companies: Accessor<T[]>;
  stages: Accessor<DealStage[]>;
  filterStages: Accessor<DealStage[]>;
  selectedStages: Accessor<string[]>;
  noStageFilter: string;
  resolveStage(company: T): string | undefined;
  canEdit: Accessor<boolean>;
  canMoveClosed: Accessor<boolean>;
  closedStages: Accessor<ReadonlySet<string>>;
  saveStage(id: string, stage: string, onError: () => void): void;
};
