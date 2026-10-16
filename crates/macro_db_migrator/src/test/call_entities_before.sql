INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('019a0000-0000-7000-8000-000000000001', 'call-model-a', 'call-model-a@test.com', 'call-model-a'),
('019a0000-0000-7000-8000-000000000002', 'call-model-b', 'call-model-b@test.com', 'call-model-b');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|call-model-a@test.com', 'call-model-a@test.com', '019a0000-0000-7000-8000-000000000001'),
('macro|call-model-b@test.com', 'call-model-b@test.com', '019a0000-0000-7000-8000-000000000002');
INSERT INTO "SharePermission" (id) VALUES ('call-model-live'), ('call-model-archive'), ('call-model-former-owner');
INSERT INTO calls (id, room_name, created_by, share_permission_id, created_at) VALUES
('019a0000-0000-7000-8000-000000000010', 'native-room', 'macro|call-model-a@test.com', 'call-model-live', '2026-01-01T10:00:00Z');
-- Legacy native storage permits owners whose account has since disappeared.
INSERT INTO calls (id, room_name, created_by, share_permission_id) VALUES
('019a0000-0000-7000-8000-000000000012', 'former-owner-room', 'macro|former-owner@test.com', 'call-model-former-owner');
INSERT INTO call_records (id, room_name, created_by, share_permission_id, started_at, ended_at, duration_ms, custom_name) VALUES
('019a0000-0000-7000-8000-000000000011', 'archived-room', 'macro|call-model-a@test.com', 'call-model-archive',
 '2026-01-01T09:00:00Z', '2026-01-01T09:05:00Z', 300000, 'Existing call');
