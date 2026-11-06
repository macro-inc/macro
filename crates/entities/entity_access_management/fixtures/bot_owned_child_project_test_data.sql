INSERT INTO public."Project" ("id", "name", "userId")
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'macro|owner@test.com');

INSERT INTO public."Project" ("id", "name", "userId", "parentId")
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bot-child', 'bot|00000000-0000-0000-0000-00000000b07a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'project', 'macro|owner@test.com', 'user', 'owner'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'project', 'b2222222-2222-2222-2222-222222222222', 'team', 'comment');

-- A bot-owned project carries its bot's owner grant and its sponsor's owner grant.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'project', 'bot|00000000-0000-0000-0000-00000000b07a', 'bot', 'owner'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'project', 'macro|owner@test.com', 'user', 'owner');
