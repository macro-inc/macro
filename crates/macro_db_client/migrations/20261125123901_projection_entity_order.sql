-- no-transaction
-- If interrupted, drop any invalid index concurrently before retrying.
CREATE INDEX CONCURRENTLY email_projection_outbox_entity_fifo
    ON public.email_projection_outbox (
        link_id,
        (COALESCE(payload->>'thread_id', payload->>'message_id', payload->>'kind')),
        seq NULLS FIRST,
        id
    );
