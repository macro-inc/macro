# Searching the workspace

Search is keyword search, not semantic: pass 1-3 words that would literally appear in the item, not the user's description. Whitespace-separated terms are ANDed. Quote a multi-word phrase; use match type `exact` for a whole word, identifier or email address. Search a person and a topic separately. To find someone's email, search their quoted address, not their name.

Search every kind of item with one `tools.search.unified_search` call rather than one per kind, keeping any scope the user gives (types, inbox, tags) on follow-ups and retries. Each search is a heavy request that often takes seconds: don't split one question into near-duplicate queries, and run the independent searches that remain together with `Promise.all`. For activity rather than keywords ("what happened today", my recent items), browse with `tools.storage.post_items_soup_ast`. Read both operations' inputs with `search` before the first call.

Preserve useful evidence from each query, and record a failed query's error with what was gathered so far. A short sample cannot establish completeness or absence.
