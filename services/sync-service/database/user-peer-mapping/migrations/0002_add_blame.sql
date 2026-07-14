CREATE TABLE blame (
    document_id  TEXT NOT NULL,
    node_id      TEXT NOT NULL,
    peer_id      TEXT NOT NULL,
    timestamp_ms INTEGER NOT NULL,
    PRIMARY KEY (document_id, node_id)
);
