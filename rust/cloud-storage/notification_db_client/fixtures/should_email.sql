INSERT INTO
  notification (
    id,
    notification_event_type,
    event_item_id,
    event_item_type,
    service_sender,
    metadata
  )
VALUES
  (
    '0193b1ea-a542-7589-893b-2b4a509c1e76',
    'cloud_storage_item_shared_user',
    'item_id',
    'item_type',
    'test',
    NULL
  );

INSERT INTO
  notification (
    id,
    notification_event_type,
    event_item_id,
    event_item_type,
    service_sender,
    metadata
  )
VALUES
  (
    '0193b1ea-a542-7589-893b-2b4a509c1e73',
    'cloud_storage_item_shared_user',
    'item_id',
    'item_type',
    'test',
    NULL
  );

INSERT INTO
  user_notification (user_id, notification_id, created_at)
VALUES
  (
    'macro|user@user.com',
    '0193b1ea-a542-7589-893b-2b4a509c1e76',
    '2019-10-16 01:00:00'
  );

INSERT INTO
  user_notification (user_id, notification_id, created_at)
VALUES
  (
    'macro|user2@user.com',
    '0193b1ea-a542-7589-893b-2b4a509c1e73',
    '2019-10-17 00:00:00'
  );

INSERT INTO
  user_notification (user_id, notification_id, created_at)
VALUES
  (
    'macro|user2@user.com',
    '0193b1ea-a542-7589-893b-2b4a509c1e76',
    '2019-10-17 00:00:00'
  );
