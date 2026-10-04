export type RoutineRow = {
  id: string;
  name: string;
  creator: string;
  createdAt: string;
  target: string;
  schedule: string;
  status: 'Active' | 'Paused' | 'Running' | 'Completed';
  editable: boolean;
  enabled: boolean;
};
