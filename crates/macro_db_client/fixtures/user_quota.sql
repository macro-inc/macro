INSERT INTO "macro_user" ("id", "username", "email", "stripe_customer_id") VALUES
('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'cus_1234'),
('a2222222-2222-2222-2222-222222222222', 'user2', 'user2@user.com', 'cus_12345');
INSERT INTO "User" ("id", "email", "name", "stripeCustomerId", "macro_user_id") VALUES
('macro|user@user.com', 'user@user.com', 'User', 'cus_1234', 'a1111111-1111-1111-1111-111111111111'),
('macro|user2@user.com', 'user2@user.com', 'User2', 'cus_12345', 'a2222222-2222-2222-2222-222222222222');

INSERT INTO "RolesOnUsers" ("userId", "roleId") VALUES
('macro|user@user.com', 'professional_subscriber'),
('macro|user@user.com', 'corporate'),
('macro|user2@user.com', 'corporate');

INSERT INTO "Document" ("id","name","fileType", "owner") VALUES
('d1', 'test_document_name','pdf', 'macro|user@user.com'),
('d2', 'test_document_name','pdf', 'macro|user@user.com'),
('d3', 'test_document_name','pdf', 'macro|user@user.com'),
('d4', 'test_document_name','pdf', 'macro|user@user.com'),
('d5', 'test_document_name','pdf', 'macro|user2@user.com');

INSERT INTO "Chat" ("id", "name", "userId") VALUES
('c1', 'test_chat_name', 'macro|user@user.com'),
('c2', 'test_chat_name', 'macro|user@user.com'),
('c3', 'test_chat_name', 'macro|user@user.com'),
('c4', 'test_chat_name', 'macro|user@user.com');

INSERT INTO "ChatMessage" ("id", "chatId", "role", "createdAt", "updatedAt", "content", "model") VALUES
('cm1', 'c1', 'user', '2023-01-01 00:00:00', '2023-01-01 00:00:00', '"test"', 'gpt-4.1'),
('cm2', 'c1', 'system', '2023-01-01 00:00:00', '2023-01-01 00:00:00', '"test"', 'gpt-4.1'),
('cm3', 'c1', 'user', '2023-01-01 00:00:00', '2023-01-01 00:00:00', '"test"', 'gpt-4.1'),
('cm4', 'c1', 'system', '2023-01-01 00:00:00', '2023-01-01 00:00:00', '"test"', 'gpt-4.1'),
('cm5', 'c2', 'user', '2023-01-01 00:00:00', '2023-01-01 00:00:00', '"test"', 'gpt-4.1'),
('cm6', 'c2', 'system', '2023-01-01 00:00:00', '2023-01-01 00:00:00', '"test"', 'gpt-4.1'),
('cm7', 'c2', 'user', '2023-01-01 00:00:00', '2023-01-01 00:00:00', '"test"', 'gpt-4.1'),
('cm8', 'c2', 'system', '2023-01-01 00:00:00', '2023-01-01 00:00:00', '"test"', 'gpt-4.1'),
('cm9', 'c3', 'user', '2023-01-01 00:00:00', '2023-01-01 00:00:00', '"test"', 'gpt-4.1'),
('cm10', 'c3', 'system', '2023-01-01 00:00:00', '2023-01-01 00:00:00', '"test"', 'gpt-4.1'),
('cm11', 'c3', 'user', '2023-01-01 00:00:00', '2023-01-01 00:00:00', '"test"', 'gpt-4.1');
