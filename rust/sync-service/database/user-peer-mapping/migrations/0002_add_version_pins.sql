CREATE TABLE version_pins (
    id           TEXT    NOT NULL PRIMARY KEY,
    document_id  TEXT    NOT NULL,
    label        TEXT    NOT NULL,
    created_by   TEXT    NOT NULL,
    pinned_at_ms INTEGER NOT NULL
);

CREATE INDEX idx_version_pins_document_id ON version_pins (document_id);
