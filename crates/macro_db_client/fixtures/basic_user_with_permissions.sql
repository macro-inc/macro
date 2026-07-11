INSERT INTO "macro_user" ("id", "username", "email", "stripe_customer_id") VALUES
('a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'cus_1234'),
('a2222222-2222-2222-2222-222222222222', 'user2@user.com', 'user2@user.com', 'cus_12345');

INSERT INTO "User" ("id", "email", "name", "stripeCustomerId", "macro_user_id") VALUES
('macro|user@user.com', 'user@user.com', 'User', 'cus_1234', 'a1111111-1111-1111-1111-111111111111'),
('macro|user2@user.com', 'user2@user.com', 'User2', 'cus_12345', 'a2222222-2222-2222-2222-222222222222');

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
