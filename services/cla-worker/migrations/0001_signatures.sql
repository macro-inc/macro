-- Append-only signature store. Keyed on GitHub's immutable numeric user ID —
-- never the login, which is mutable and recyclable. A user signs each CLA
-- version at most once; signing a new version is a new row. Rows are never
-- mutated or deleted; corrections are new rows or a manual D1 operation with
-- a paper trail.
CREATE TABLE IF NOT EXISTS signatures (
  github_id    INTEGER NOT NULL, -- immutable numeric GitHub user ID
  github_login TEXT    NOT NULL, -- login at signing time; display only, never keyed on
  cla_version  TEXT    NOT NULL, -- version tag of the text they agreed to
  signed_at    TEXT    NOT NULL, -- ISO 8601 UTC
  ip           TEXT,             -- evidentiary; from CF-Connecting-IP
  PRIMARY KEY (github_id, cla_version)
);
