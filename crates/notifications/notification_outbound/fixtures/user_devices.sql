INSERT INTO notification_user_device_registration (
    id, user_id, device_token, device_endpoint, device_type, created_at, updated_at
) VALUES
    ('017d85a8-c7c6-7c40-b4f3-a6c1b3c0d1e2'::uuid,
     'macro|user1@test.com',
     'ios_token_123',
     'arn:aws:sns:us-east-1:000:endpoint/APNS/app/device123',
     'ios',
     '2025-02-28 10:00:00',
     '2025-02-28 10:00:00'),
    ('017d85a8-c7c6-7c40-b4f3-a6c1b3c0d1e3'::uuid,
     'macro|user1@test.com',
     'android_token_456',
     'arn:aws:sns:us-east-1:000:endpoint/GCM/app/device456',
     'android',
     '2025-02-28 11:00:00',
     '2025-02-28 11:00:00');
