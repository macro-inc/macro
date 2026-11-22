INSERT INTO notification_user_device_registration (
    id, user_id, device_token, device_endpoint, device_type, created_at, updated_at
) VALUES
    ('017d85a8-c7c6-7c40-b4f3-a6c1b3c0d101'::uuid,
     'macro|alice@example.com',
     'alice_ios_token',
     'arn:aws:sns:us-east-1:000:endpoint/APNS/app/alice-phone',
     'ios',
     '2025-02-28 10:00:00',
     '2025-02-28 10:00:00'),
    ('017d85a8-c7c6-7c40-b4f3-a6c1b3c0d102'::uuid,
     'macro|bob@example.com',
     'bob_ios_token',
     'arn:aws:sns:us-east-1:000:endpoint/APNS/app/bob-phone',
     'ios',
     '2025-02-28 10:00:00',
     '2025-02-28 10:00:00');
