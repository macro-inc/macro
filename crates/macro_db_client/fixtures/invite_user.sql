INSERT INTO "Organization" ("id", "name") VALUES (1, 'test organization');
INSERT INTO "OrganizationEmailMatches" ("email", "organizationId") VALUES ('macro.com', 1);
INSERT INTO "OrganizationInvitation" ("email", "organization_id") VALUES ('user@macro.com', 1);

INSERT INTO "Organization" ("id", "name", "allowListOnly") VALUES (2, 'test organization 2', true);
INSERT INTO "OrganizationEmailMatches" ("email", "organizationId") VALUES ('user@test.com', 2);
INSERT INTO "OrganizationEmailMatches" ("email", "organizationId") VALUES ('user@test2.com', 2);
