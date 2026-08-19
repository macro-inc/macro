-- Give user-a's channels different created_at and updated_at orderings so the
-- channel-list cursor regression test exercises both sort methods.
UPDATE comms_channels
SET created_at = '2024-01-01 00:00:00+00',
    updated_at = '2024-01-03 00:00:00+00'
WHERE id = '00000000-0000-0000-0000-000000000c01';

UPDATE comms_channels
SET created_at = '2024-01-02 00:00:00+00',
    updated_at = '2024-01-02 00:00:00+00'
WHERE id = '00000000-0000-0000-0000-000000000c03';
