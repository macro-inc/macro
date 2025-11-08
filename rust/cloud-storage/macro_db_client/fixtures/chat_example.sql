INSERT INTO public."User" ("id","email","stripeCustomerId")
VALUES ('macro|user@user.com', 'user@user.com','stripe_id');

-- Test Documents
INSERT INTO public."Document" ("id","name","fileType", "owner")
VALUES ('document-one', 'test_document_name','pdf', 'macro|user@user.com');
INSERT INTO public."Document" ("id","name","fileType", "owner")
VALUES ('document-two', 'test_document_name','pdf', 'macro|user@user.com');
INSERT INTO public."Document" ("id","name","fileType", "owner")
VALUES ('document-three', 'test_document_name','pdf', 'macro|user@user.com');

-- Test Chats
INSERT INTO public."Chat" ("id","name","userId", "model", "createdAt", "updatedAt")
VALUES ('chat-one', 'test-chat', 'macro|user@user.com', 'gpt-4o', '2019-10-16 00:00:00', '2019-10-16 00:00:00');
INSERT INTO public."Chat" ("id","name","userId", "model", "createdAt", "updatedAt")
VALUES ('chat-two', 'test-chat 2', 'macro|user@user.com', 'gpt-4o', '2019-10-16 00:00:01', '2019-10-16 00:00:01');
INSERT INTO public."Chat" ("id","name","userId", "model", "createdAt", "updatedAt")
VALUES ('chat-three', 'test-chat 3', 'macro|user@user.com', 'gpt-4o', '2019-10-16 00:00:01', '2019-10-16 00:00:01');

-- Chat Messages
INSERT INTO public."ChatMessage" ("id", "content", "role", "chatId")
VALUES ('message-one', '"test-chat message"', 'system', 'chat-three');

INSERT INTO public."ChatMessage" ("id", "content", "role", "chatId")
VALUES ('message-two', '"test-chat message 2"', 'user', 'chat-three');

-- Chat attachments on both chat
INSERT INTO public."ChatAttachment" ("id", "chatId", "attachmentType", "attachmentId")
VALUES ('chat-attachment-one', 'chat-one', 'document', 'document-two');
INSERT INTO public."ChatAttachment" ("id", "chatId", "attachmentType", "attachmentId")
VALUES ('chat-attachment-two', 'chat-one', 'document', 'document-two');
INSERT INTO public."ChatAttachment" ("id", "chatId", "attachmentType", "attachmentId")
VALUES ('chat-attachment-six', 'chat-two', 'document', 'document-two');

-- Chat attachments on messages
INSERT INTO public."ChatAttachment" ("id", "messageId", "attachmentType", "attachmentId")
VALUES ('chat-attachment-three', 'message-one', 'document', 'document-one');
INSERT INTO public."ChatAttachment" ("id", "messageId", "attachmentType", "attachmentId")
VALUES ('chat-attachment-four', 'message-one', 'document', 'document-two');
INSERT INTO public."ChatAttachment" ("id", "messageId", "attachmentType", "attachmentId")
VALUES ('chat-attachment-five', 'message-one', 'document', 'document-three');
