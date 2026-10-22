-- Accounts set up by the person's own AI agent over MCP ("agent-led") skip
-- the web onboarding flow. The web app reads these to show a first-visit
-- "here's what your agent set up" view instead.
--
-- agent_led_at: when the account was marked agent-led; NULL = not agent-led.
-- agent_client: the MCP client that led setup (e.g. "claude-code"), for the
-- first-visit view and analytics. Free text from the client's registration.
-- agent_setup_done_at: when the agent's setup reached its final report, so
-- later sessions stop leading with setup even if nothing was imported.
ALTER TABLE user_onboarding
    ADD COLUMN agent_led_at TIMESTAMPTZ,
    ADD COLUMN agent_client TEXT,
    ADD COLUMN agent_setup_done_at TIMESTAMPTZ;
