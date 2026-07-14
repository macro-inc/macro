CREATE TABLE peer_user_map (
    document_id TEXT NOT NULL,
    -- peer_id should be BIGINT, but d1 doesn't support this
    peer_id     TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    PRIMARY KEY (document_id, peer_id)
);

CREATE INDEX idx_peer_user_map_user_doc ON peer_user_map (document_id, user_id);
CREATE INDEX idx_document_id ON peer_user_map (document_id);
