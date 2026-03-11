-- Contacts DB schema migration
-- Combined from contacts_db_client migrations:
-- - 20250304215122_connections.sql
-- - 20250402150453_created_updated.sql
-- - 20251120181854_fix_check.sql

CREATE TABLE contacts_connections (
	id SERIAL PRIMARY KEY,
	user1 TEXT NOT NULL,
	user2 TEXT NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE(user1, user2),
	CHECK(user1 <= user2 COLLATE "C")
);

CREATE INDEX idx_contacts_connections_user1 ON contacts_connections(user1);
CREATE INDEX idx_contacts_connections_user2 ON contacts_connections(user2);
