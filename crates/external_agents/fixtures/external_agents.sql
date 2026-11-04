INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('91000000-0000-0000-0000-000000000001', 'owner', 'owner@example.com', 'external-agents-owner');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|owner@example.com', 'owner@example.com', '91000000-0000-0000-0000-000000000001');
INSERT INTO bots (id, kind, owner_user_id, name, handle, created_by, has_agent) VALUES
('91000000-0000-0000-0000-000000000021', 'owned', 'macro|owner@example.com', 'Outside Assistant', 'outside', 'macro|owner@example.com', true),
('91000000-0000-0000-0000-000000000022', 'owned', 'macro|owner@example.com', 'Other Assistant', 'other', 'macro|owner@example.com', true);
INSERT INTO webhook (id, workspace_id, namespace, name, endpoint_url, signing_secret, filters, created_by_user_id) VALUES
('wh_outside', 'macro|owner@example.com', 'external-agent:outside', 'Outside Assistant (external agent)', 'https://agent.example.com/macro', 'whsec_test', '[{"events": ["external_agent.message"]}]', 'macro|owner@example.com');
