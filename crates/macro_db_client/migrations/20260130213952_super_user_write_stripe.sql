INSERT INTO "RolesOnPermissions" ("permissionId","roleId") VALUES
    ('write:stripe_subscription','super_admin') ON CONFLICT DO NOTHING;