I want to revamp the ordering and priority of search results in the kommand menu.

Acceptance Criteria:

[ ] Items in the Kommand menu are ordered by viewed_at by default.
[ ] Channels and DM's are prioritized when there is a search query. Simmilar to how it works in the unified list. If I type "Jacob" i expect the channel to be first not a document.
[ ] You have unit tests to make sure the behavior is correct and stable
[ ] Without a query you should see them ordered by viewed_at
[ ] kommand menu should be live updated when you open items. This is the optimistic updating.

Prerequisite Steps:
[ ] Port the history call to the queries package following the existing patterns.
[ ] Figure out the existing mechanism for updating the viewed_at time for blocks. We need to make sure this is optimistically updated in both history and soup calls in an idiomatic way.
[ ] Write tests to ensure the viewed_at optimistic updates work as expected


Issues from your previous implementation:
[ ] default ordering is not by viewed_at
[ ] item ordering is not live updating when im opening new items
