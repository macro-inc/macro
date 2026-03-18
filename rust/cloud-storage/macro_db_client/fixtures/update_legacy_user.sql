INSERT INTO "macro_user" ("id", "username", "email", "stripe_customer_id") VALUES
('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'cus_1234'),
('a2222222-2222-2222-2222-222222222222', 'user2', 'user2@user.com', 'cus_12345');
INSERT INTO "User" ("id", "email", "name", "stripeCustomerId", "macro_user_id") VALUES
('legacy|user@user.com', 'user@user.com', 'User', 'cus_1234', 'a1111111-1111-1111-1111-111111111111'),
('legacy|user2@user.com', 'user2@user.com', 'User2', 'cus_12345', 'a2222222-2222-2222-2222-222222222222');

INSERT INTO "Role" ("id", "description") VALUES
('role-one', 'Role One'),
('role-two', 'Role Two');

INSERT INTO "RolesOnUsers" ("userId", "roleId") VALUES
('legacy|user@user.com', 'role-one'),
('legacy|user2@user.com', 'role-two');

INSERT INTO "Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES
    ('document-one', 'test_document_name', 'pdf', 'legacy|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO "Project" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES
    ('project-one', 'a', 'legacy|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');
  
INSERT INTO "Chat" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES
    ('chat-one', 'test-chat', 'legacy|user@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00');
