Run SQL against the current user's Macro databases — the only way to read or change their rows. SELECT to answer a question, INSERT/UPDATE/DELETE to change data, CREATE/ALTER/DROP to edit schema. One statement per call.

**Every table the user can see is already in scope, across all of their databases.** The statement runs as the user against exactly what they are allowed to read: a table they cannot see simply does not exist, and a table they only have view access to is read-only. Always pass `databaseId` for the database the statement is about, so its tables win name ties.

**Call DescribeDatabase first unless you already know the exact table and column names.** Names are the display names the user typed, so quote the ones with spaces. If a statement fails, the error names what was wrong and suggests the closest name — read it, fix it, retry.

## Dialect

