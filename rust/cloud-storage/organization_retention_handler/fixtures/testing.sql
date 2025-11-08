INSERT INTO "Organization" (id, name) VALUES (1, 'test organization');

INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id', 1);
INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2', 1);
INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user3@user.com', 'user3@user.com','stripe_id3');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'd1', 'test_document_name','pdf', 'macro|user@user.com');
INSERT INTO public."ItemLastAccessed" ("item_id", "item_type", "last_accessed")
(SELECT 'd1', 'document', NOW() - INTERVAL '5 days');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'd1a', 'test_document_name','pdf', 'macro|user@user.com');
INSERT INTO public."ItemLastAccessed" ("item_id", "item_type", "last_accessed")
(SELECT 'd1a', 'document', NOW() - INTERVAL '1 days');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'd2', 'test_document_name','docx', 'macro|user2@user.com');
INSERT INTO public."ItemLastAccessed" ("item_id", "item_type", "last_accessed")
(SELECT 'd2', 'document', NOW() - INTERVAL '2 days');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'd3', 'test_document_name','md', 'macro|user3@user.com');
INSERT INTO public."ItemLastAccessed" ("item_id", "item_type", "last_accessed")
(SELECT 'd3', 'document', NOW() - INTERVAL '33 days');

INSERT INTO public."Chat" ("id","name","userId")
(SELECT 'c1', 'test_chat_name', 'macro|user@user.com');
INSERT INTO public."ItemLastAccessed" ("item_id", "item_type", "last_accessed")
(SELECT 'c1', 'chat', NOW() - INTERVAL '5 days');

INSERT INTO public."Chat" ("id","name","userId")
(SELECT 'c1a', 'test_chat_name', 'macro|user@user.com');
INSERT INTO public."ItemLastAccessed" ("item_id", "item_type", "last_accessed")
(SELECT 'c1a', 'chat', NOW() - INTERVAL '1 days');

INSERT INTO public."Chat" ("id","name","userId")
(SELECT 'c2', 'test_chat_name', 'macro|user2@user.com');
INSERT INTO public."ItemLastAccessed" ("item_id", "item_type", "last_accessed")
(SELECT 'c2', 'chat', NOW() - INTERVAL '2 days');

INSERT INTO public."Chat" ("id","name","userId")
(SELECT 'c3', 'test_chat_name', 'macro|user3@user.com');
INSERT INTO public."ItemLastAccessed" ("item_id", "item_type", "last_accessed")
(SELECT 'c3', 'chat', NOW() - INTERVAL '33 days');
