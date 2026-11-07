-- References include a duplicate attachment, an agent in a reply, and scoped exclusions.
INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id, created_at) VALUES
  ('019a0000-0000-7000-8000-000000000001', 'message', '00000000-0000-0000-0000-000000000001', 'document', 'doc-1', '2024-01-01 10:00:00+00'),
  ('019a0000-0000-7000-8000-000000000002', 'message', '00000000-0000-0000-0000-000000000003', 'document', 'mentioned-doc', '2024-01-01 12:00:00+00'),
  ('019a0000-0000-7000-8000-000000000003', 'message', '00000000-0000-0000-0000-00000000b001', 'agent_session', 'shared-agent', '2024-01-01 12:00:00+00'),
  ('019a0000-0000-7000-8000-000000000004', 'message', '00000000-0000-0000-0000-000000000002', 'document', 'deleted-reference', '2024-01-01 12:00:00+00'),
  ('019a0000-0000-7000-8000-000000000005', 'message', '00000000-0000-0000-0000-000000000005', 'document', 'other-channel-reference', '2024-01-01 12:00:00+00'),
  ('019a0000-0000-7000-8000-000000000006', 'message', '00000000-0000-0000-0000-000000000003', 'user', 'macro|user-a@test.com', '2024-01-01 12:00:00+00');
