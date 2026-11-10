CREATE INDEX password_item_entities_member_removal ON password_item_entities(member_removal_id,id) WHERE member_removal_id IS NOT NULL;
