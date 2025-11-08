INSERT INTO "User" ("id", "email", "name", "stripeCustomerId") VALUES
('macro|user@user.com', 'user@user.com', 'User', 'cus_1234'),
('macro|user2@user.com', 'user2@user.com', 'User2', 'cus_12345');

INSERT INTO "Permission" ("id", "description") VALUES
('permission-one', 'Permission One'),
('permission-two', 'Permission Two'),
('permission-three', 'Permission Three');

INSERT INTO "Role" ("id", "description") VALUES
('role-one', 'Role One'),
('role-two', 'Role Two'),
('role-three', 'Role Three');

INSERT INTO "RolesOnPermissions" ("permissionId", "roleId") VALUES
('permission-one', 'role-one'),
('permission-three', 'role-one'),
('permission-two', 'role-two'),
('permission-three', 'role-three');

INSERT INTO "RolesOnUsers" ("userId", "roleId") VALUES
('macro|user@user.com', 'role-one'),
('macro|user@user.com', 'role-three'),
('macro|user2@user.com', 'role-two');
