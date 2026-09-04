ALTER TABLE bots
    ADD COLUMN provisioning_key TEXT,
    ADD CONSTRAINT bots_provisioning_key_owner_check CHECK (
        provisioning_key IS NULL OR (owner_user_id IS NOT NULL AND team_id IS NULL)
    );

CREATE UNIQUE INDEX bots_owner_provisioning_key_unique
    ON bots (owner_user_id, provisioning_key)
    WHERE provisioning_key IS NOT NULL;

CREATE FUNCTION sync_cursor_persona() RETURNS TRIGGER AS $$
DECLARE
    persona_id UUID;
BEGIN
    PERFORM set_config('macro.cursor_persona_lifecycle', 'enabled', true);
    IF TG_OP = 'DELETE' THEN
        UPDATE bots
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE owner_user_id = OLD.user_id
          AND provisioning_key = 'cursor'
          AND deleted_at IS NULL;
        RETURN OLD;
    END IF;

    IF NEW.user_id NOT LIKE '%@macro.com' THEN
        RETURN NEW;
    END IF;

    INSERT INTO bots (
        id, kind, owner_user_id, name, handle, description, created_by,
        has_agent, provisioning_key
    )
    VALUES (
        gen_random_uuid(), 'owned', NEW.user_id, 'Cursor', 'cursor',
        'Your private Cursor coding agent.', NEW.user_id, true, 'cursor'
    )
    ON CONFLICT (owner_user_id, provisioning_key)
        WHERE provisioning_key IS NOT NULL
    DO UPDATE SET deleted_at = NULL, updated_at = NOW()
    RETURNING id INTO persona_id;

    INSERT INTO agent_configs (
        bot_id, instructions, harness, default_model, channel_scope
    )
    VALUES (persona_id, '', 'cursor', 'default', 'all')
    ON CONFLICT (bot_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cursor_configs_sync_persona
AFTER INSERT OR UPDATE OR DELETE ON cursor_configs
FOR EACH ROW EXECUTE FUNCTION sync_cursor_persona();

CREATE FUNCTION protect_cursor_persona() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.provisioning_key = 'cursor'
       AND current_setting('macro.cursor_persona_lifecycle', true) IS DISTINCT FROM 'enabled'
       AND (
           NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
           OR NEW.team_id IS DISTINCT FROM OLD.team_id
           OR NEW.has_agent IS DISTINCT FROM OLD.has_agent
           OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
           OR NEW.provisioning_key IS DISTINCT FROM OLD.provisioning_key
       ) THEN
        RAISE EXCEPTION 'Cursor persona lifecycle fields are managed by its connection';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bots_protect_cursor_persona
BEFORE UPDATE ON bots
FOR EACH ROW EXECUTE FUNCTION protect_cursor_persona();

CREATE FUNCTION protect_cursor_agent_config() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.harness = 'cursor'
       AND NOT EXISTS (
           SELECT 1 FROM bots
           WHERE id = NEW.bot_id AND provisioning_key = 'cursor'
       ) THEN
        RAISE EXCEPTION 'Cursor runtime requires a provisioned private persona';
    END IF;
    IF EXISTS (
        SELECT 1 FROM bots
        WHERE id = OLD.bot_id AND provisioning_key = 'cursor'
    ) AND (
        NEW.harness IS DISTINCT FROM OLD.harness
        OR NEW.harness_id IS DISTINCT FROM OLD.harness_id
        OR NEW.channel_scope IS DISTINCT FROM OLD.channel_scope
    ) THEN
        RAISE EXCEPTION 'Cursor persona runtime fields are managed by its connection';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_configs_protect_cursor_persona
BEFORE INSERT OR UPDATE ON agent_configs
FOR EACH ROW EXECUTE FUNCTION protect_cursor_agent_config();

-- Existing Cursor connections receive the same private persona that future key
-- registrations provision. gen_random_uuid() is available through pgcrypto.
INSERT INTO bots (
    id, kind, owner_user_id, name, handle, description, created_by, has_agent,
    provisioning_key
)
SELECT
    gen_random_uuid(),
    'owned',
    config.user_id,
    'Cursor',
    'cursor',
    'Your private Cursor coding agent.',
    config.user_id,
    true,
    'cursor'
FROM cursor_configs AS config
WHERE NOT EXISTS (
    SELECT 1
    FROM bots
    WHERE owner_user_id = config.user_id
      AND provisioning_key = 'cursor'
)
  AND config.user_id LIKE '%@macro.com';

INSERT INTO agent_configs (
    bot_id, instructions, harness, default_model, channel_scope
)
SELECT id, '', 'cursor', 'default', 'all'
FROM bots
WHERE provisioning_key = 'cursor'
ON CONFLICT (bot_id) DO NOTHING;
