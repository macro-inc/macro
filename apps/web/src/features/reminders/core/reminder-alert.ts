/** A delivered reminder occurrence, independent of its transport or toast UI. */
export type ReminderAlert = {
  key: string;
  reminderId: string;
  description: string;
  scheduledFor?: string;
};
