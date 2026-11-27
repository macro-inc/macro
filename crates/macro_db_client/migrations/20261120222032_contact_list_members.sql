-- Directed, list-aware contact membership owned by crates/contacts. A person is in
-- a user's directory when they are in at least one of that user's lists; Teammates
-- is computed from team_user at read time and has no rows here. Both tables store
-- only canonical lowercase ids, so plain C-collated keys serve keyset paging.
--
-- The foreign key to email_links takes SHARE ROW EXCLUSIVE on it, blocking its
-- writers until this file commits; everything else touches only new tables.
SET LOCAL lock_timeout = '5s';

-- Stored lists not tied to an inbox: interacted, invited, and custom lists later.
-- Rows are removed by application code on account deletion.
CREATE TABLE contact_list_members (
    user_id         text COLLATE "C" NOT NULL,
    contact_user_id text COLLATE "C" NOT NULL,
    list_key        text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, contact_user_id, list_key),
    CONSTRAINT contact_list_members_not_self CHECK (user_id <> contact_user_id)
);

-- "Who has X in their directory": picture fan-out and the SSE contacts check.
CREATE INDEX contact_list_members_contact_idx
    ON contact_list_members (contact_user_id, user_id);

-- People known through one connected inbox. Disconnecting the inbox cascades its
-- rows, and a contact also known through the owner's other inbox keeps that row.
-- user_id and list_key repeat the link's owner and provider so reads never join
-- email_links.
CREATE TABLE contact_inbox_members (
    user_id         text COLLATE "C" NOT NULL,
    contact_user_id text COLLATE "C" NOT NULL,
    link_id         uuid NOT NULL REFERENCES email_links (id) ON DELETE CASCADE,
    list_key        text NOT NULL CHECK (list_key IN ('gmail', 'outlook')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, contact_user_id, link_id),
    CONSTRAINT contact_inbox_members_not_self CHECK (user_id <> contact_user_id)
);

CREATE INDEX contact_inbox_members_contact_idx
    ON contact_inbox_members (contact_user_id, user_id);

-- Serves the email_links delete cascade.
CREATE INDEX contact_inbox_members_link_idx ON contact_inbox_members (link_id);
