INSERT INTO
  notification (
    id,
    notification_event_type,
    event_item_id,
    event_item_type,
    service_sender,
    metadata,
    sender_id,
    apns_collapse_key
  )
VALUES
  (
    '0193b1ea-a542-7589-893b-2b4a509c1e76',
    'message',
    'item-123',
    'document',
    'test-service',
    '{}',
    'macro|user@user.com',
    NULL
  );
