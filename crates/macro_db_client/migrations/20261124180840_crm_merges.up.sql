-- Foreign keys lock team and crm_companies against writes while they are added.
SET LOCAL lock_timeout = '5s';

-- One row per merge of CRM records. The survivor and source ids carry no
-- foreign key: the log outlives the records it names.
CREATE TABLE crm_merges
(
    id                  UUID        PRIMARY KEY,
    team_id             UUID        NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    user_id             TEXT        NOT NULL,
    record_type         TEXT        NOT NULL CHECK (record_type IN ('company', 'contact')),
    request_key         UUID        NOT NULL,
    request_fingerprint TEXT        NOT NULL,
    survivor_id         UUID        NOT NULL,
    source_ids          UUID[]      NOT NULL,
    result              JSONB       NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A repeated request key returns the saved result instead of merging again.
    UNIQUE (team_id, user_id, request_key)
);

-- Every row a merge changed, with the value it had before. `owner` is the
-- crate whose table it is.
CREATE TABLE crm_merge_changes
(
    merge_id   UUID    NOT NULL REFERENCES crm_merges (id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    owner      TEXT    NOT NULL,
    table_name TEXT    NOT NULL,
    row_key    JSONB   NOT NULL,
    previous   JSONB   NOT NULL,
    PRIMARY KEY (merge_id, seq)
);

-- The id of a company merged away, and the company it now names. A later
-- merge re-points these rows to the newer survivor, so a chain is never
-- followed. Deleting the survivor deletes its aliases, so the old ids name
-- nothing again.
CREATE TABLE crm_company_aliases
(
    retired_id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES crm_companies (id) ON DELETE CASCADE,
    merge_id   UUID NOT NULL REFERENCES crm_merges (id) ON DELETE CASCADE,
    CHECK (retired_id <> company_id)
);

CREATE INDEX crm_company_aliases_company_id_idx ON crm_company_aliases (company_id);
CREATE INDEX crm_company_aliases_merge_id_idx ON crm_company_aliases (merge_id);
