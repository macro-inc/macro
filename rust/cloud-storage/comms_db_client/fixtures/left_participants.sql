-- Mark user7 as having left public channel
UPDATE comms_channel_participants
SET left_at = '2024-06-13T12:00:00Z'
WHERE channel_id = '33333333-3333-3333-3333-333333333333'
  AND user_id = 'user7';
