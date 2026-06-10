CREATE TABLE blame (
    document_id  TEXT NOT NULL,
    node_id      TEXT NOT NULL,
    peer_id      TEXT NOT NULL,
    timestamp_ms INTEGER NOT NULL,
    PRIMARY KEY (document_id, node_id)
);

CREATE INDEX idx_blame_document_id ON blame (document_id);
