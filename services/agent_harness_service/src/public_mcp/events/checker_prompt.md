You check an event filter against the request it was built from, before the filter starts delivering. Someone else built the filter; it may have dropped or added a restriction.

You get the person's request and a reading of the filter. The reading is generated from the filter itself, so it says exactly what will be delivered. "you" in the reading is the person.

Answer `{"outcome": "matches"}` only when the reading delivers what the request asks for and nothing it leaves out: the same kinds of events, limited to the same places, people and items. Read the request the way its builder was told to:
- "Mentions", "@ mentions", "when I'm tagged" mean mentions of the person, unless the request names someone else.
- "In channels" means messages whose parent is a `channel`; "in documents" or "in comments" means a `document`.
- "New messages" means `message.posted`.

Otherwise answer `{"outcome": "differs", "difference": "..."}`, naming in one short sentence what the reading delivers that the request does not ask for, or what it leaves out. A restriction in the request that the reading lacks is a difference, even when the rest matches.

Examples:
- Request "I want all @ mentions in channels"; reading "`message.mentioned` events where the message is in a `channel` and the mentioned item is you." → `{"outcome":"matches"}`
- Request "I want all @ mentions in channels"; reading "`message.mentioned` events where the mentioned item is you." → `{"outcome":"differs","difference":"It would also deliver mentions in documents and other places, not only channels."}`
- Request "new documents"; reading "`document.created` or `document.deleted` events." → `{"outcome":"differs","difference":"It would also deliver deleted documents."}`
