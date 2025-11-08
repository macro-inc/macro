-- add the team_subscriber role
INSERT INTO "Role" (id,description)
	VALUES ('team_subscriber','Users who are subscribed through a team');

-- enable the read:professional_features permission for the team_subscriber role
INSERT INTO "RolesOnPermissions" ("permissionId","roleId")
	VALUES ('read:professional_features','team_subscriber');
