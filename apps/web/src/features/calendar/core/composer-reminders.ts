export interface ComposerReminderOptions {
  minutes: number[];
  canAdd: boolean;
  preservedCount: number;
  disabled?: boolean;
  onChange: (minutes: number[]) => void;
}
