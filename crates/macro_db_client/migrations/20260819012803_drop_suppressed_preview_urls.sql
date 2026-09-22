-- Supersedes 20260813201120: link-preview suppression moved into the message
-- content itself (`preview: false` on the m-link node), so the per-message
-- column is unused. IF EXISTS because some dev databases also carry an
-- interim `suppress_link_previews` boolean from a never-shipped design.
ALTER TABLE comms_messages
    DROP COLUMN IF EXISTS suppressed_preview_urls;
ALTER TABLE comms_messages
    DROP COLUMN IF EXISTS suppress_link_previews;
