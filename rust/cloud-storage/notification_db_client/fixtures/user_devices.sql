INSERT INTO user_device_registration (
    id,
    user_id,
    device_token,
    device_endpoint,
    device_type,
    created_at,
    updated_at,
    last_used_at
) VALUES 
    -- iOS device for user1
    ('017d85a8-c7c6-7c40-b4f3-a6c1b3c0d1e2'::uuid,
    'macro|user1@macro.com',
    'ios_device_token_123',
    'arn:aws:sns:region:account:endpoint/APNS/app/device123',
    'ios',
    '2025-02-28 10:00:00',
    '2025-02-28 10:00:00',
    '2025-02-28 12:30:00'),

    -- Android device for user1
    ('017d85a8-c7c6-7c40-b4f3-a6c1b3c0d1e3'::uuid,
    'macro|user1@macro.com',
    'android_device_token_456',
    'arn:aws:sns:region:account:endpoint/GCM/app/device456',
    'android',
    '2025-02-28 11:00:00',
    '2025-02-28 11:00:00',
    '2025-02-28 13:45:00'),

    -- iOS device for user2
    ('017d85a8-c7c6-7c40-b4f3-a6c1b3c0d1e4'::uuid,
    'macro|user2@macro.com',
    'ios_device_token_789',
    'arn:aws:sns:region:account:endpoint/APNS/app/device789',
    'ios',
    '2025-02-28 09:00:00',
    '2025-02-28 09:00:00',
    NULL);
