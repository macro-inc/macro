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
export type RoutineTemplate = {
  id: string;
  name: string;
  description: string;
  category: 'Macro' | 'Integrations';
  integration: string;
  prompt: string;
  days: string[];
  time: string;
};
