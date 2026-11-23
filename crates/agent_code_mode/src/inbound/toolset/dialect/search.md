# Searching the workspace

Search is keyword search, not semantic: pass 1-3 words that would literally appear in the item, not the user's description. Whitespace-separated terms are ANDed. Quote a multi-word phrase; use match type `exact` for a whole word, identifier or email address. Search a person and a topic separately. To find someone's email, search their quoted address, not their name.

Search every kind of item with one `tools.search.unified_search` call rather than one per kind, keeping any scope the user gives (types, inbox, tags) on follow-ups and retries. Each search is a heavy request that often takes seconds: don't split one question into near-duplicate queries, and run the independent searches that remain together with `Promise.all`. For activity rather than keywords ("what happened today", my recent items, my latest tasks), list items with `tools.storage.post_items_soup_ast` as below. Read `tools.search.unified_search`'s inputs with `search` before its first call.

Preserve useful evidence from each query, and record a failed query's error with what was gathered so far. A short sample cannot establish completeness or absence.

## Listing items

`tools.storage.post_items_soup_ast` lists the items the person can open, most recently viewed first unless sorted otherwise. Its body holds one filter per kind of item and the page options, all optional:

- A filter is a literal `{l: {<key>: <value>}}` with one key, or `{"&": [a, b]}`, `{"|": [a, b]}` or `{"!": a}`. `&` and `|` take exactly two filters; nest them for more.
- `df` filters documents and tasks (a task is a document): `{l: {dst: "task"}}` is tasks (`snippet` and `skill` are the other subtypes), `{"!": {l: {dst: "task"}}}` everything but tasks, `{l: {ft: "md"}}` a file type (`md`, `pdf`, `canvas`, ...), `{l: {nc: "plan"}}` a name containing the text, and `{l: {ca: {gte: "2026-11-01T00:00:00Z"}}}` or `ua` a created or updated bound (`gt`, `gte`, `lt`, `lte`).
- Every kind without a filter is listed too: emails, chats, channels, threads, calls, events and more. To list only documents or tasks, rule out each other kind with an id no item has, the nil id `00000000-0000-0000-0000-000000000000`, in `pf` (`pid`), `cf` (`cid`), `ef` (`ThreadId`), `chanf` (`ChannelId`), `cthf` (`ThreadId`), `callf` (`CallId`), `calf` (`id`), `fef` (`id`) and `ccf` (`id`), as below. Agent sessions, initiatives, CRM contacts and database rows are listed only when asked for.
- `limit` is the page size (20 by default, at most 500); `sort_method` is `updated_at`, `created_at` or `viewed_at` (the default), each of which works with these filters; `sort_direction` is `desc` (the default) or `asc`.

It returns `{items, next_cursor}`. Each item's `tag` is its kind (`document` for documents and tasks) and its `data` holds `id`, `name`, `fileType`, `ownerId`, `createdAt`, `updatedAt` and `subType`, which is `{type: "task", is_completed}` for a task and absent for a plain document. For the next page, send the same body again with `query: {cursor: next_cursor}`; `next_cursor` is null on the last page.

```js
// The five most recently updated tasks.
const none = "00000000-0000-0000-0000-000000000000";
const page = await tools.storage.post_items_soup_ast({
  body: {
    df: { l: { dst: "task" } },
    pf: { l: { pid: none } }, cf: { l: { cid: none } }, ef: { l: { ThreadId: none } },
    chanf: { l: { ChannelId: none } }, cthf: { l: { ThreadId: none } }, callf: { l: { CallId: none } },
    calf: { l: { id: none } }, fef: { l: { id: none } }, ccf: { l: { id: none } },
    limit: 5, sort_method: "updated_at", sort_direction: "desc",
  },
});
return page.items.map((item) => ({
  id: item.data.id, name: item.data.name, done: item.data.subType.is_completed, updatedAt: item.data.updatedAt,
}));
```

```js
// Markdown documents other than tasks, created since November 1, newest first, page by page up to 300.
const none = "00000000-0000-0000-0000-000000000000";
const body = {
  df: { "&": [{ l: { ft: "md" } }, { "&": [{ "!": { l: { dst: "task" } } }, { l: { ca: { gte: "2026-11-01T00:00:00Z" } } }] }] },
  pf: { l: { pid: none } }, cf: { l: { cid: none } }, ef: { l: { ThreadId: none } },
  chanf: { l: { ChannelId: none } }, cthf: { l: { ThreadId: none } }, callf: { l: { CallId: none } },
  calf: { l: { id: none } }, fef: { l: { id: none } }, ccf: { l: { id: none } },
  limit: 100, sort_method: "created_at", sort_direction: "desc",
};
const documents = [];
let cursor = null;
do {
  const page = await tools.storage.post_items_soup_ast({ body, query: cursor ? { cursor } : undefined });
  for (const item of page.items) documents.push({ id: item.data.id, name: item.data.name, createdAt: item.data.createdAt });
  cursor = page.next_cursor;
} while (cursor && documents.length < 300);
return { documents, complete: !cursor };
```
