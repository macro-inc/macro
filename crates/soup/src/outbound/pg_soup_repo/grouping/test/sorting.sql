-- Deliberately separated date buckets and tied entity timestamps.
UPDATE "Document" SET "createdAt" = current_date - interval '400 days' + interval '12 hours',
                      "updatedAt" = current_date - interval '1 day' + interval '12 hours';
UPDATE "Chat" SET "createdAt" = current_date - interval '400 days' + interval '12 hours',
                  "updatedAt" = current_date - interval '1 day' + interval '12 hours';
UPDATE "Project" SET "createdAt" = current_date - interval '400 days' + interval '12 hours',
                     "updatedAt" = current_date - interval '1 day' + interval '12 hours';
DELETE FROM "UserHistory" WHERE "userId" = 'macro|user-1@test.com';
INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "updatedAt")
SELECT 'macro|user-1@test.com', id, kind,
       current_date + interval '12 hours' - age
FROM (VALUES
('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', interval '0 days'),
('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', interval '500 days'),
('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', interval '0 days'),
('22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'chat', interval '500 days'),
('aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'project', interval '0 days'),
('bbbbbbbb-ffff-ffff-ffff-ffffffffffff', 'project', interval '500 days')
) history(id, kind, age)
ON CONFLICT DO NOTHING;
