-- Spreadsheet comments anchor to a cell range on one sheet. Additive: the
-- anchor stays a tagged jsonb object on document roots only.
ALTER TABLE comms_message_threads
    DROP CONSTRAINT comms_message_threads_anchor_check,
    ADD CONSTRAINT comms_message_threads_anchor_check CHECK (
        anchor IS NULL OR (
            jsonb_typeof(anchor) = 'object'
            AND anchor->>'type' IN ('markdown', 'pdf_highlight', 'pdf_placeable', 'spreadsheet')
        )
    );
