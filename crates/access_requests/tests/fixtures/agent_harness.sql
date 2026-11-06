-- Independent agent computer, its team, and a separate team shared with its human owner.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ('00000000-0000-0000-0000-000000000001', 'owner@requests.test', 'owner@requests.test', 'billing_owner');
INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ('macro|owner@requests.test', 'owner@requests.test', '00000000-0000-0000-0000-000000000001', false);
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ('00000000-0000-0000-0000-000000000002', 'teamowner@requests.test', 'teamowner@requests.test', 'billing_teamowner');
INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ('macro|teamowner@requests.test', 'teamowner@requests.test', '00000000-0000-0000-0000-000000000002', false);
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ('00000000-0000-0000-0000-000000000003', 'admin@requests.test', 'admin@requests.test', 'billing_admin');
INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ('macro|admin@requests.test', 'admin@requests.test', '00000000-0000-0000-0000-000000000003', false);
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ('00000000-0000-0000-0000-000000000004', 'member@requests.test', 'member@requests.test', 'billing_member');
INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ('macro|member@requests.test', 'member@requests.test', '00000000-0000-0000-0000-000000000004', false);
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ('00000000-0000-0000-0000-000000000005', 'recipient@requests.test', 'recipient@requests.test', 'billing_recipient');
INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ('macro|recipient@requests.test', 'recipient@requests.test', '00000000-0000-0000-0000-000000000005', false);
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ('00000000-0000-0000-0000-000000000006', 'agent@requests.test', 'agent@requests.test', 'billing_agent');
INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ('macro|agent@requests.test', 'agent@requests.test', '00000000-0000-0000-0000-000000000006', true);
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ('00000000-0000-0000-0000-000000000007', 'outsider@requests.test', 'outsider@requests.test', 'billing_outsider');
INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ('macro|outsider@requests.test', 'outsider@requests.test', '00000000-0000-0000-0000-000000000007', false);
INSERT INTO team (id, name, owner_id) VALUES ('00000000-0000-0000-0000-000000000020', 'Agent team', 'macro|teamowner@requests.test'), ('00000000-0000-0000-0000-000000000021', 'Other team', 'macro|owner@requests.test');
INSERT INTO team_user (user_id, team_id, team_role) VALUES ('macro|admin@requests.test', '00000000-0000-0000-0000-000000000020', 'admin');
INSERT INTO team_user (user_id, team_id, team_role) VALUES ('macro|member@requests.test', '00000000-0000-0000-0000-000000000020', 'member');
INSERT INTO team_user (user_id, team_id, team_role) VALUES ('macro|recipient@requests.test', '00000000-0000-0000-0000-000000000020', 'member');
INSERT INTO team_user (user_id, team_id, team_role) VALUES ('macro|agent@requests.test', '00000000-0000-0000-0000-000000000020', 'admin');
INSERT INTO team_user (user_id, team_id, team_role) VALUES ('macro|owner@requests.test', '00000000-0000-0000-0000-000000000021', 'member');
INSERT INTO team_user (user_id, team_id, team_role) VALUES ('macro|outsider@requests.test', '00000000-0000-0000-0000-000000000021', 'member');
INSERT INTO hosted_runtime (id, team_id, name, size, units, state, created_by, harness_id, persona)
VALUES ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000020', 'Agent computer', 'standard', 1, '{}', 'macro|owner@requests.test', '00000000-0000-0000-0000-000000000050', '{"name":"Agent","os_user":"agent-example","extra_service":{"unit_name":"brain@agent-example","exec":"/opt/macro/brain run","env":{}},"config":{}}');
INSERT INTO harnesses (id, name, owner_user_id, created_by, computer_id)
VALUES ('00000000-0000-0000-0000-000000000050', 'Agent runtime', 'macro|owner@requests.test', 'macro|owner@requests.test', '00000000-0000-0000-0000-000000000040');
INSERT INTO team_agents (user_id, team_id, created_by, computer_id)
VALUES ('macro|agent@requests.test', '00000000-0000-0000-0000-000000000020', 'macro|owner@requests.test', '00000000-0000-0000-0000-000000000040');
