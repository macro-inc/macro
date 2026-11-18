-- An owner asking whether a phone number has a WhatsApp account, to start a
-- direct chat with it. DSS records the request; the session service holding
-- the account asks WhatsApp and records the answer. Rows count toward the
-- per-account lookup budget and are deleted once outside it.
CREATE TABLE whatsapp_lookup (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    phone_number text NOT NULL CHECK (phone_number ~ '^[+][1-9][0-9]{6,14}$'),
    state text NOT NULL CHECK (state IN ('pending', 'found', 'not_on_whatsapp', 'failed')),
    chat_jid text CHECK (chat_jid ~ '^[0-9]+@s[.]whatsapp[.]net$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((state = 'found') = (chat_jid IS NOT NULL)),
    CHECK ((state = 'pending') = (completed_at IS NULL))
);
CREATE INDEX whatsapp_lookup_account_created ON whatsapp_lookup(account_id, created_at);
