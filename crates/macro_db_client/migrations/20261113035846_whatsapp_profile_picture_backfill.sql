-- Track the pictures of chats and people added before pictures were, as
-- adoption and ingest track new ones (see whatsapp_linked's pictures.rs).
-- Everything starts due; the per-account query budget paces the checks.
-- Only reads other tables, but never wait behind a long transaction.
SET LOCAL lock_timeout = '5s';

-- Each added chat's group or direct chat, for its owner's account.
INSERT INTO whatsapp_profile_picture (account_id, jid, state)
SELECT a.id, c.remote_id, 'due'
FROM external_chat c
JOIN whatsapp_linked_account a ON a.user_id = c.user_id
WHERE c.provider = 'whatsapp' AND c.state <> 'detached'
  AND (c.remote_id ~ '^[0-9]+@(s[.]whatsapp[.]net|lid)$' OR c.remote_id ~ '^[0-9-]+@g[.]us$')
ON CONFLICT (account_id, jid) DO NOTHING;

-- Each person of an added chat who is not a Macro user, once, by their LID
-- when known, unless one of their aliases is already tracked (a direct
-- chat's other person is, by the chat above).
INSERT INTO whatsapp_profile_picture (account_id, jid, state)
SELECT DISTINCT ON (a.id, p.id) a.id, x.jid, 'due'
FROM external_chat c
JOIN whatsapp_linked_account a ON a.user_id = c.user_id
JOIN external_chat_person p ON p.chat_id = c.id AND p.user_id IS NULL
JOIN whatsapp_identity_alias x ON x.chat_id = c.id AND x.person_id = p.id
WHERE c.provider = 'whatsapp' AND c.state <> 'detached'
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_identity_alias s
    JOIN whatsapp_profile_picture t ON t.account_id = a.id AND t.jid = s.jid
    WHERE s.chat_id = c.id AND s.person_id = p.id)
ORDER BY a.id, p.id, x.jid LIKE '%@lid' DESC, x.jid
ON CONFLICT (account_id, jid) DO NOTHING;
