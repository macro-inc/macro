INSERT INTO "Role" (id, description)
    VALUES ('sub_haiku', 'User is subscribed to the haiku pricing plan'),
        ('sub_sonnet', 'User is subscribed to the sonnet pricing plan'),
        ('sub_opus', 'User is subscribed to the opus pricing plan') ON CONFLICT DO NOTHING;


INSERT INTO "Permission" (id, description) VALUES
    ('write:haiku', 'Allow users to use haiku'),
    ('write:sonnet', 'Allow users to use sonnet'),
    ('write:opus', 'Allow users to use opus') ON CONFLICT DO NOTHING;


INSERT INTO "RolesOnPermissions" ("permissionId", "roleId") VALUES
    ('write:haiku', 'sub_haiku'),
    ('write:haiku', 'sub_sonnet'), -- sonnet access haiku
    ('write:opus', 'sub_opus'), -- opus accesses haiku
    ('write:sonnet', 'sub_sonnet'),
    ('write:sonnet', 'sub_opus'), -- opus accesses sonnet
    ('write:opus', 'sub_opus'),
    ('write:haiku', 'corporate') ON CONFLICT DO NOTHING;
