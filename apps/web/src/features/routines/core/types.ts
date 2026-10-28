export type RoutineRow = {
  id: string;
  name: string;
  creator: string;
  createdAt: string;
  target: string;
  /** Model the routine runs on, when the target names or implies one. */
  targetModel?: string;
  schedule: string;
  status: 'Active' | 'Paused' | 'Running' | 'Completed';
  editable: boolean;
  enabled: boolean;
};
