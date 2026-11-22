-- Documents for the source-list equality test, after viewer_matrix.sql.
-- Every grant source reaches a document each way a source can: a direct
-- grant, a grant on an email thread the document is attached to, and a grant
-- on the parent of a discussion it is attached to. Link shares and legacy
-- (non-uuid) documents cover the owner-team and channel-share paths.

-- Direct grants: one document per source, and one holding every grant.
INSERT INTO "Document" (id, name, owner)
SELECT matrix_item('document', source_id)::text, 'Direct', 'macro|matrix-owner@example.com'
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('document', 'all')::text, 'All grants', 'macro|matrix-owner@example.com';
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('document', source_id), 'document', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('document', 'all'), 'document', source_id, source_type, level
FROM matrix_grant_source;

-- Link shares: TEAM links by owners in team A, in team B and in no team,
-- a PUBLIC link, and a TEAM link without a level.
INSERT INTO "Document" (id, name, owner) VALUES
('7a000000-0000-0000-0000-00000000a001', 'Team A link', 'macro|matrix-owner@example.com'),
('7a000000-0000-0000-0000-00000000a002', 'Team B link', 'macro|matrix-other@example.com'),
('7a000000-0000-0000-0000-00000000a003', 'Teamless link', 'macro|matrix-loner@example.com'),
('7a000000-0000-0000-0000-00000000a004', 'Public link', 'macro|matrix-loner@example.com'),
('7a000000-0000-0000-0000-00000000a005', 'Levelless link', 'macro|matrix-owner@example.com');
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel") VALUES
('7a000000-0000-0000-0000-00000000a001', 'TEAM', 'comment'),
('7a000000-0000-0000-0000-00000000a002', 'TEAM', 'edit'),
('7a000000-0000-0000-0000-00000000a003', 'TEAM', 'edit'),
('7a000000-0000-0000-0000-00000000a004', 'PUBLIC', 'view'),
('7a000000-0000-0000-0000-00000000a005', 'TEAM', NULL);
INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId")
SELECT id, id FROM "SharePermission" WHERE id LIKE '7a000000-0000-0000-0000-00000000a%';

-- Email attachments: matrix-other's inbox holds one thread per source, each
-- granted to that source and carrying an attached document. matrix-loner is
-- delegated the inbox.
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
('7a000000-0000-0000-0000-00000000e001', 'macro|matrix-other@example.com', 'macro|matrix-other@example.com', 'matrix-inbox@mail.test', 'GMAIL');
INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) VALUES
('macro|matrix-loner@example.com', 'macro|matrix-other@example.com', '7a000000-0000-0000-0000-00000000e001');
INSERT INTO email_threads (id, link_id)
SELECT matrix_item('thread', source_id), '7a000000-0000-0000-0000-00000000e001'
FROM matrix_grant_source;
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('thread', source_id), 'email_thread', source_id, source_type, level
FROM matrix_grant_source;
INSERT INTO email_messages (id, thread_id, link_id)
SELECT matrix_item('message', source_id), matrix_item('thread', source_id), '7a000000-0000-0000-0000-00000000e001'
FROM matrix_grant_source;
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type)
SELECT matrix_item('email-attachment', source_id), matrix_item('message', source_id),
       matrix_item('email-attachment', source_id)::text, 'report.pdf', 'application/pdf'
FROM matrix_grant_source;
INSERT INTO "Document" (id, name, owner)
SELECT matrix_item('attachment', source_id)::text, 'Email attachment', 'macro|matrix-other@example.com'
FROM matrix_grant_source;
INSERT INTO document_email (document_id, email_attachment_id)
SELECT matrix_item('attachment', source_id)::text, matrix_item('email-attachment', source_id)
FROM matrix_grant_source;

-- Discussion attachments: a parent document per source, granted to it, whose
-- discussion attaches a child document; and a parent with a team A link.
INSERT INTO "Document" (id, name, owner)
SELECT matrix_item('parent', source_id)::text, 'Discussion parent', 'macro|matrix-other@example.com'
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('discussed', source_id)::text, 'Discussion attachment', 'macro|matrix-other@example.com'
FROM matrix_grant_source
UNION ALL
SELECT '7a000000-0000-0000-0000-00000000a006', 'Team A link parent', 'macro|matrix-owner@example.com'
UNION ALL
SELECT '7a000000-0000-0000-0000-00000000a007', 'Team A link attachment', 'macro|matrix-other@example.com';
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('parent', source_id), 'document', source_id, source_type, level
FROM matrix_grant_source;
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel") VALUES
('7a000000-0000-0000-0000-00000000a006', 'TEAM', 'edit');
INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId") VALUES
('7a000000-0000-0000-0000-00000000a006', '7a000000-0000-0000-0000-00000000a006');
INSERT INTO comms_messages (id, sender_id, content, parent_entity_type, parent_entity_id)
SELECT matrix_item('discussion', source_id), 'macro|matrix-other@example.com', 'attachment', 'document',
       matrix_item('parent', source_id)::text
FROM matrix_grant_source
UNION ALL
SELECT '7a000000-0000-0000-0000-00000000a006', 'macro|matrix-other@example.com', 'attachment', 'document',
       '7a000000-0000-0000-0000-00000000a006';
INSERT INTO comms_attachments (id, message_id, entity_type, entity_id)
SELECT matrix_item('discussion-attachment', source_id), matrix_item('discussion', source_id), 'document',
       matrix_item('discussed', source_id)::text
FROM matrix_grant_source
UNION ALL
SELECT '7a000000-0000-0000-0000-00000000a007', '7a000000-0000-0000-0000-00000000a006', 'document',
       '7a000000-0000-0000-0000-00000000a007';

-- Legacy documents (ids that are not uuids): one per source shared with it
-- as a channel, one per source in a project granted to it, and team A and
-- team B links.
INSERT INTO "Project" (id, name, "userId")
SELECT 'legacy-project-' || source_id, 'Legacy project', 'macro|matrix-other@example.com'
FROM matrix_grant_source;
INSERT INTO "Document" (id, name, owner, "projectId")
SELECT 'legacy-channel-' || source_id, 'Legacy channel share', 'macro|matrix-other@example.com', NULL
FROM matrix_grant_source
UNION ALL
SELECT 'legacy-project-' || source_id, 'Legacy in project', 'macro|matrix-other@example.com', 'legacy-project-' || source_id
FROM matrix_grant_source
UNION ALL
SELECT 'legacy-team-a', 'Legacy team A link', 'macro|matrix-owner@example.com', NULL
UNION ALL
SELECT 'legacy-team-b', 'Legacy team B link', 'macro|matrix-other@example.com', NULL;
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel")
SELECT 'legacy-channel-' || source_id, NULL, NULL::"AccessLevel" FROM matrix_grant_source
UNION ALL
SELECT 'legacy-team-a', 'TEAM', 'comment'
UNION ALL
SELECT 'legacy-team-b', 'TEAM', 'edit';
INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId")
SELECT id, id FROM "SharePermission" WHERE id LIKE 'legacy-%';
INSERT INTO "ChannelSharePermission" (share_permission_id, channel_id, access_level)
SELECT 'legacy-channel-' || source_id, source_id, level FROM matrix_grant_source;
-- entity_access.entity_id is a uuid, so the legacy project grants live on
-- uuid projects that hold legacy documents.
INSERT INTO "Project" (id, name, "userId")
SELECT matrix_item('legacy-project', source_id)::text, 'Legacy uuid project', 'macro|matrix-other@example.com'
FROM matrix_grant_source;
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('legacy-project', source_id), 'project', source_id, source_type, level
FROM matrix_grant_source;
INSERT INTO "Document" (id, name, owner, "projectId")
SELECT 'legacy-uuid-project-' || source_id, 'Legacy in uuid project', 'macro|matrix-other@example.com',
       matrix_item('legacy-project', source_id)::text
FROM matrix_grant_source;
