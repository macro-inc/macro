-- Collapse the three tiered AI permissions (write:haiku/write:sonnet/write:opus)
-- into a single write:proai permission.
--
-- New model: free users get haiku (no AI permission needed), paid users get
-- everything (write:proai). Roles are remapped accordingly:
--   sub_haiku  -> (no AI permission; haiku is the free default)
--   sub_sonnet -> write:proai
--   sub_opus   -> write:proai
--   corporate  -> write:proai
-- The sub_haiku/sub_sonnet/sub_opus roles themselves are retained (they track
-- the user's Stripe subscription tier); only the permissions they grant change.

-- 1. Introduce the new permission.
INSERT INTO "Permission" (id, description) VALUES
    ('write:proai', 'Allow users to use professional (paid) AI models')
ON CONFLICT DO NOTHING;

-- 2. Grant write:proai to the paid roles.
INSERT INTO "RolesOnPermissions" ("permissionId", "roleId") VALUES
    ('write:proai', 'sub_sonnet'),
    ('write:proai', 'sub_opus'),
    ('write:proai', 'corporate')
ON CONFLICT DO NOTHING;

-- 3. Remove every mapping to the old tiered permissions (covers sub_haiku,
--    sub_sonnet, sub_opus, corporate and any other role they were attached to).
DELETE FROM "RolesOnPermissions"
WHERE "permissionId" IN ('write:haiku', 'write:sonnet', 'write:opus');

-- 4. Drop the now-orphaned permissions.
DELETE FROM "Permission"
WHERE id IN ('write:haiku', 'write:sonnet', 'write:opus');
