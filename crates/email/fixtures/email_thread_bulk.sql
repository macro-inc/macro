-- Layered on email_importance_pagination: user1's inbox gets its UNREAD
-- label so bulk Mark Unread can resolve it.
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('1a000005-0000-0000-0000-000000000005', 'a1111111-1111-1111-1111-111111111111', 'UNREAD', 'UNREAD', 'Show', 'LabelShow', 'System', NOW());
