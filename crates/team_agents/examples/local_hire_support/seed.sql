BEGIN;
INSERT INTO macro_user(id, username, email, stripe_customer_id) VALUES
  ('0193a1b2-0000-7000-8000-000000000011','macrobots-reviewer@example.test','macrobots-reviewer@example.test','cus_local_hire_only'),
  ('0193a1b2-0000-7000-8000-000000000012','sentinel@example.test','sentinel@example.test','cus_local_sentinel_only');
INSERT INTO "User"(id,email,macro_user_id) VALUES
  ('macro|macrobots-reviewer@example.test','macrobots-reviewer@example.test','0193a1b2-0000-7000-8000-000000000011'),
  ('macro|sentinel@example.test','sentinel@example.test','0193a1b2-0000-7000-8000-000000000012');
INSERT INTO team(id,name,slug,owner_id,seat_count) VALUES
  ('0193a1b2-0000-7000-8000-0000000000aa','Macro Bots Local Review','LOCAL_HIRE','macro|macrobots-reviewer@example.test',1),
  ('0193a1b2-0000-7000-8000-0000000000bb','Hire isolation sentinel','LOCAL_HIRE_SENTINEL','macro|sentinel@example.test',1);
INSERT INTO team_user(user_id, team_id, team_role) VALUES
  ('macro|macrobots-reviewer@example.test','0193a1b2-0000-7000-8000-0000000000aa','owner'),
  ('macro|sentinel@example.test','0193a1b2-0000-7000-8000-0000000000bb','owner');
COMMIT;
BEGIN;
INSERT INTO macro_user(id,username,email,stripe_customer_id)
  VALUES ('0193a1b2-0000-7000-8000-000000000013','sentinel-agent','sentinel-agent@agents.macro.invalid','cus_synthetic_agent');
INSERT INTO "User"(id,email,macro_user_id,"isAgent")
  VALUES ('macro|sentinel-agent@agents.macro.invalid','sentinel-agent@agents.macro.invalid','0193a1b2-0000-7000-8000-000000000013',TRUE);
INSERT INTO team_user(user_id,team_id,team_role,seat_included)
  VALUES ('macro|sentinel-agent@agents.macro.invalid','0193a1b2-0000-7000-8000-0000000000bb','member',TRUE);
INSERT INTO team_agents(user_id,team_id,created_by,persona_seed,purchase_key)
  VALUES ('macro|sentinel-agent@agents.macro.invalid','0193a1b2-0000-7000-8000-0000000000bb','macro|sentinel@example.test','{"name":"Isolation Sentinel","job_description":"","personality":""}','local-hire-sentinel');
COMMIT;
