export type EmailReminderCondition = 'if_no_reply' | 'regardless';
export type ReminderTimeOption = {
  id: string;
  date: Date;
  label: string;
  /** What was guessed in reading a typed time, shown beside it. */
  note?: string;
};
