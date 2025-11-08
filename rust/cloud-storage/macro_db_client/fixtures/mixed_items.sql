-- Disable foreign key constraints temporarily for easier setup
SET session_replication_role = 'replica';

-- Create Organization (needed for User foreign key)
INSERT INTO public."Organization" ("id",
                                   "name",
                                   "status") (SELECT 1,
                                                     'Test Organization',
                                                     'PILOT');

-- Insert user
INSERT INTO public."User" ("id",
                           "email",
                           "stripeCustomerId",
                           "organizationId") (SELECT 'macro|user@user.com',
                                                     'user@user.com',
                                                     'stripe_id',
                                                     1);

-- Create project
INSERT INTO public."Project" ("id",
                              "name",
                              "userId",
                              "createdAt",
                              "updatedAt") (SELECT 'test-project',
                                                   'Test Project',
                                                   'macro|user@user.com',
                                                   '2023-01-17 12:00:00',
                                                   '2023-01-17 12:00:00');

-- Create DocumentFamily (needed for Document)
INSERT INTO public."DocumentFamily" ("id",
                                     "rootDocumentId") (SELECT 1,
                                                               'test-document');

-- Create document
INSERT INTO public."Document" ("id",
                               "name",
                               "fileType",
                               "owner",
                               "createdAt",
                               "updatedAt",
                               "documentFamilyId",
                               "projectId") (SELECT 'test-document',
                                                    'Test Document',
                                                    'pdf',
                                                    'macro|user@user.com',
                                                    '2023-01-15 10:00:00',
                                                    '2023-01-15 10:00:00',
                                                    1,
                                                    'test-project');

-- Add document instance
INSERT INTO public."DocumentInstance" ("id",
                                       "revisionName",
                                       "documentId",
                                       "createdAt",
                                       "updatedAt",
                                       "sha") (SELECT 1,
                                                      'Test Document',
                                                      'test-document',
                                                      '2023-01-15 10:00:00',
                                                      '2023-01-15 10:00:00',
                                                      'abc123sha');

-- Create chat
INSERT INTO public."Chat" ("id",
                           "userId",
                           "name",
                           "createdAt",
                           "updatedAt",
                           "isPersistent",
                           "projectId") (SELECT 'test-chat',
                                                'macro|user@user.com',
                                                'Test Chat',
                                                '2023-01-16 11:00:00',
                                                '2023-01-16 11:00:00',
                                                true,
                                                'test-project');

-- Add user access to all items with different access levels to test DISTINCT ON
INSERT INTO public."UserItemAccess" ("id",
                                     "user_id",
                                     "item_id",
                                     "item_type",
                                     "access_level",
                                     "created_at") (SELECT gen_random_uuid(),
                                                           'macro|user@user.com',
                                                           'test-document',
                                                           'document',
                                                           'owner',
                                                           '2023-01-15 10:00:00');

-- Add another access level for document to ensure we get the highest one
INSERT INTO public."UserItemAccess" ("id",
                                     "user_id",
                                     "item_id",
                                     "item_type",
                                     "access_level",
                                     "created_at") (SELECT gen_random_uuid(),
                                                           'macro|user@user.com',
                                                           'test-document',
                                                           'document',
                                                           'view',
                                                           '2023-01-15 10:30:00');

INSERT INTO public."UserItemAccess" ("id",
                                     "user_id",
                                     "item_id",
                                     "item_type",
                                     "access_level",
                                     "created_at") (SELECT gen_random_uuid(),
                                                           'macro|user@user.com',
                                                           'test-chat',
                                                           'chat',
                                                           'owner',
                                                           '2023-01-16 11:00:00');

INSERT INTO public."UserItemAccess" ("id",
                                     "user_id",
                                     "item_id",
                                     "item_type",
                                     "access_level",
                                     "created_at") (SELECT gen_random_uuid(),
                                                           'macro|user@user.com',
                                                           'test-project',
                                                           'project',
                                                           'owner',
                                                           '2023-01-17 12:00:00');

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';