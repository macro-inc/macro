DO $$
BEGIN
    IF (SELECT count(*) FROM comms_messages) <> 3
       OR (SELECT count(*) FROM comms_message_threads) <> 3
       OR (SELECT count(*) FROM comms_attachments) <> 1
       OR (SELECT count(*) FROM migrated_comment_id WHERE comment_id = 2 AND document_id = 'drop-doc') <> 1
       OR (SELECT count(*) FROM migrated_comment_thread_id WHERE thread_id = 1 AND document_id = 'drop-doc') <> 1 THEN
        RAISE EXCEPTION 'migration lost messages, attachments, threads, or legacy mappings';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "PdfPlaceableCommentAnchor" WHERE root_id = '019a0000-0000-7000-8000-000000000003' AND "xPct" = 0.1)
       OR NOT EXISTS (SELECT 1 FROM "PdfHighlightAnchor" WHERE root_id = '019a0000-0000-7000-8000-000000000003' AND text = 'text') THEN
        RAISE EXCEPTION 'migration lost PDF geometry or root linkage';
    END IF;
    IF to_regclass('"Comment"') IS NOT NULL OR to_regclass('"Thread"') IS NOT NULL
       OR to_regclass('"ThreadAnchor"') IS NOT NULL OR to_regclass('crm_comment') IS NOT NULL
       OR to_regclass('crm_thread') IS NOT NULL THEN
        RAISE EXCEPTION 'legacy tables remain';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
               AND ((table_name IN ('comms_messages', 'comms_attachments') AND column_name = 'channel_id')
                 OR (table_name IN ('PdfPlaceableCommentAnchor', 'PdfHighlightAnchor') AND column_name = 'threadId'))) THEN
        RAISE EXCEPTION 'legacy columns remain';
    END IF;
    -- NEW.channel_id is valid on unrelated tables such as import_target;
    -- only message/attachment triggers lose that record field in this drop.
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE pronamespace = 'public'::regnamespace
               AND ((prosrc LIKE '%NEW.channel_id%' AND EXISTS (
                   SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid
                   AND t.tgrelid IN ('comms_messages'::regclass, 'comms_attachments'::regclass)))
                   OR prosrc LIKE '%"threadId"%' OR prosrc LIKE '%crm_comment%')) THEN
        RAISE EXCEPTION 'function still depends on retired schema';
    END IF;
    IF to_regclass('idx_comms_messages_parent_timeline') IS NULL
       OR to_regclass('idx_comms_messages_parent_history') IS NULL
       OR to_regclass('idx_comms_messages_parent_activity') IS NULL
       OR to_regclass('idx_comms_attachments_entity_created') IS NULL THEN
        RAISE EXCEPTION 'required lookup index missing';
    END IF;
END;
$$;

UPDATE comms_messages SET deleted_at = now() WHERE id = '019a0000-0000-7000-8000-000000000003';
DELETE FROM comms_channels WHERE id = '019a0000-0000-7000-8000-000000000002';
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM notification) OR EXISTS (SELECT 1 FROM comms_attachments)
       OR (SELECT count(*) FROM comms_messages) <> 2 OR (SELECT count(*) FROM comms_message_threads) <> 2 THEN
        RAISE EXCEPTION 'notification cleanup or channel deletion cascade failed';
    END IF;
END;
$$;
