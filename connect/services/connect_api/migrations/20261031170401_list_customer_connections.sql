-- no-transaction
CREATE INDEX CONCURRENTLY connections_customer_created_id_idx
    ON connections (customer_id, created_at DESC, id DESC);
