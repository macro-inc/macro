import type { EmailFollowup } from '@service-storage/generated/schemas/emailFollowup';

export type EmailRowReminder = EmailFollowup & { name: string };
