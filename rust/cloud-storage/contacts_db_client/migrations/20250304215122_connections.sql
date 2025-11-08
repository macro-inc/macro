CREATE TABLE connections (
	id SERIAL PRIMARY KEY,
	user1 TEXT NOT NULL,
	user2 TEXT NOT NULL,
	UNIQUE(user1, user2),
	CHECK(user1 <= user2)
);

CREATE INDEX idx_connections_user1 ON connections(user1);
CREATE INDEX idx_connections_user2 ON connections(user2);
