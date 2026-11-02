/** The source a question is asked over, sent to the model as JSON. */
export type DatabaseQuestionSchema = {
  /** Absent when the source is chosen automatically. */
  databaseId?: string;
  name: string;
  focusTableId?: string;
  tables: {
    id: string;
    name: string;
    platform?: true;
    sqlName: string;
    primaryKey?: string;
    columns: {
      name: string;
      sqlName: string;
      type: string;
      options: string[];
      multiple: boolean;
      relation?: { databaseId: string; tableId: string; writable: boolean };
    }[];
  }[];
};

export type DatabaseQuestionInput = {
  prompt: string;
  sql: string;
  schema: DatabaseQuestionSchema;
  error?: string;
};
