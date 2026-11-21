-- A row in this table silences an item for its owner. This flag keeps the
-- owner's direct @mentions on that item flowing while everything else stays
-- silenced. Constant default: no table rewrite, and rows written by services
-- that predate the column stay full mutes.
ALTER TABLE user_notification_item_unsubscribe
    ADD COLUMN mentions_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN user_notification_item_unsubscribe.mentions_only IS
    'TRUE silences the item except for notifications that @mention the user directly.';
