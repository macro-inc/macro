-- Document-parent messages have no channel, so their attachments carry no
-- channel_id. Channel writers keep filling the column; it goes away with
-- channel_id on comms_messages in the last PR of the stack.
ALTER TABLE comms_attachments
    ALTER COLUMN channel_id DROP NOT NULL;

-- A placeable PDF comment created through the shared message store is anchored
-- by its root only. Legacy placeables keep their "threadId"; every row still
-- points at exactly one discussion.
ALTER TABLE "PdfPlaceableCommentAnchor"
    ALTER COLUMN "threadId" DROP NOT NULL,
    ADD CONSTRAINT "PdfPlaceableCommentAnchor_discussion_check"
        CHECK ("threadId" IS NOT NULL OR root_id IS NOT NULL);
