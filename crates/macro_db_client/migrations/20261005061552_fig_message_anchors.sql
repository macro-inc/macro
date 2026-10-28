SET LOCAL lock_timeout = '5s';

-- Design (`.fig`) discussions pin to a page point, on a layer or the canvas.
ALTER TABLE comms_message_threads
    DROP CONSTRAINT comms_message_threads_anchor_check,
    ADD CONSTRAINT comms_message_threads_anchor_check CHECK (
        anchor IS NULL OR (
            jsonb_typeof(anchor) = 'object'
            AND anchor->>'type' IN ('markdown', 'pdf_highlight', 'pdf_placeable', 'spreadsheet', 'fig')
        )
    ) NOT VALID;
