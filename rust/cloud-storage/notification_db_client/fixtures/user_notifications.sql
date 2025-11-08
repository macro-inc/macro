INSERT INTO
  notification (
    id,
    notification_event_type,
    event_item_id,
    event_item_type,
    service_sender,
    metadata,
    sender_id
  )
VALUES
  (
    '0193b1ea-a542-7589-893b-2b4a509c1e76',
    'test',
    'test',
    'test',
    'test',
    NULL,
    'macro|user2@user.com'
  );

INSERT INTO
  notification (
    id,
    notification_event_type,
    event_item_id,
    event_item_type,
    service_sender,
    metadata,
    sender_id
  )
VALUES
  (
    '0193b1ea-a542-7589-893b-2b4a509c1e75',
    'test',
    'test',
    'test',
    'test',
    NULL,
    NULL
  );

INSERT INTO
  notification (
    id,
    notification_event_type,
    event_item_id,
    event_item_type,
    service_sender,
    metadata,
    sender_id
  )
VALUES
  (
    '0193b1ea-a542-7589-893b-2b4a509c1e74',
    'test',
    'test',
    'test',
    'test',
    NULL,
    NULL
  );

INSERT INTO
  notification (
    id,
    notification_event_type,
    event_item_id,
    event_item_type,
    service_sender,
    metadata,
    sender_id
  )
VALUES
  (
    '0193b1ea-a542-7589-893b-2b4a509c1e73',
    'test',
    'test',
    'test',
    'test',
    NULL,
    NULL
  );

INSERT INTO
  user_notification (user_id, notification_id, created_at)
VALUES
  (
    'macro|user@user.com',
    '0193b1ea-a542-7589-893b-2b4a509c1e76',
    '2019-10-16 00:00:00'
  );

INSERT INTO
  user_notification (user_id, notification_id, created_at)
VALUES
  (
    'macro|user@user.com',
    '0193b1ea-a542-7589-893b-2b4a509c1e75',
    '2019-10-17 00:00:00'
  );

INSERT INTO
  user_notification (user_id, notification_id, created_at)
VALUES
  (
    'macro|user@user.com',
    '0193b1ea-a542-7589-893b-2b4a509c1e74',
    '2019-10-18 00:00:00'
  );

INSERT INTO
  user_notification (user_id, notification_id, created_at, seen_at)
VALUES
  (
    'macro|user@user.com',
    '0193b1ea-a542-7589-893b-2b4a509c1e73',
    '2019-10-18 00:00:00',
    '2019-10-18 00:00:00'
  );


