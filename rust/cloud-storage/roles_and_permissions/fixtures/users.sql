INSERT INTO "User" ("id", "email", "name", "stripeCustomerId") VALUES
('macro|user@user.com', 'user@user.com', 'User', 'cus_1234'),
('macro|user2@user.com', 'user2@user.com', 'User2', 'cus_12345');

INSERT INTO "RolesOnUsers" ("userId", "roleId") VALUES
('macro|user@user.com', 'professional_subscriber'),
('macro|user@user.com', 'corporate'),
('macro|user2@user.com', 'corporate');
