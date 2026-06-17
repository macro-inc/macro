CREATE TABLE version_pins (
    id           TEXT    NOT NULL PRIMARY KEY,
    label        TEXT    NOT NULL,
    created_by   TEXT    NOT NULL,
    pinned_at_ms INTEGER NOT NULL
);
