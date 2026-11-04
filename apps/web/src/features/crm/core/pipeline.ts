/** Pipeline identity and sharing are independent of its customizable table. */
export type Pipeline = {
  id: string;
  teamId: string;
  name: string;
  userId: string;
  recordType: 'company' | 'contact';
  databaseId: string;
  tableId: string;
  primaryColumnId: string;
  /** Stable host roles; absent while an older server is still serving metadata. */
  commercialFields?: {
    outcome?: string | null;
    money?: { amount: string; currency: string }[];
  };
  sharing: 'private' | 'team';
  grant: 'view' | 'comment' | 'edit' | 'owner';
  createdAt: string;
  trashedAt: string | null;
};

export type NewPipeline = Pick<Pipeline, 'name' | 'recordType' | 'sharing'>;
