INSERT INTO "Organization" ("id", "name") VALUES (1, 'test organization');
INSERT INTO "OrganizationRetentionPolicy" ("id", "organization_id", "retention_days") VALUES (1, 1, 30);

INSERT INTO "Organization" ("id", "name") VALUES (2, 'test organization 2');
INSERT INTO "OrganizationRetentionPolicy" ("id", "organization_id") VALUES (2, 2);

INSERT INTO "Organization" ("id", "name") VALUES (3, 'test organization 3');
