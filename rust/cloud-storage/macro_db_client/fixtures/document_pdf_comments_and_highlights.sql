-- Setup organizations and users
INSERT INTO
    public."Organization" ("id", "name")
VALUES
    (1, 'organization-one');

INSERT INTO
    public."User" (
        "id",
        "email",
        "stripeCustomerId",
        "organizationId"
    )
VALUES
    (
        'macro|user@user.com',
        'user@user.com',
        'stripe_id',
        1
    );

INSERT INTO
    public."User" ("id", "email", "stripeCustomerId")
VALUES
    (
        'macro|user2@user.com',
        'user2@user.com',
        'stripe_id2'
    );

--------------------------------------------------
-- Document with comments
--------------------------------------------------
-- Create a PDF document that will have comments
INSERT INTO
    public."Document" (
        "id",
        "name",
        "fileType",
        "owner",
        "createdAt",
        "updatedAt"
    )
VALUES
    (
        'document-with-comments',
        'Document With Comments',
        'pdf',
        'macro|user@user.com',
        '2022-01-01 00:00:00',
        '2022-01-01 00:00:00'
    );

-- Create document instance for the PDF
INSERT INTO
    public."DocumentInstance" (
        "id",
        "documentId",
        "sha",
        "createdAt",
        "updatedAt"
    )
VALUES
    (
        100,
        'document-with-comments',
        'sha-pdf-comments',
        '2022-01-01 00:00:00',
        '2022-01-01 00:00:00'
    );

-- Add share permissions
INSERT INTO
    public."SharePermission" (
        "id",
        "isPublic",
        "publicAccessLevel",
        "createdAt",
        "updatedAt"
    )
VALUES
    (
        'sp-comments',
        false,
        NULL,
        '2022-01-01 00:00:00',
        '2022-01-01 00:00:00'
    );

INSERT INTO
    public."DocumentPermission" ("documentId", "sharePermissionId")
VALUES
    ('document-with-comments', 'sp-comments');

-- Create threads for the document
INSERT INTO
    public."Thread" (
        "id",
        "owner",
        "documentId",
        "createdAt",
        "updatedAt",
        "deletedAt",
        "resolved"
    )
VALUES
    (
        1001,
        'macro|user@user.com',
        'document-with-comments',
        '2022-01-10 10:00:00',
        '2022-01-10 10:00:00',
        NULL,
        false
    ),
    (
        1002,
        'macro|user@user.com',
        'document-with-comments',
        '2022-01-10 11:30:00',
        '2022-01-10 11:30:00',
        NULL,
        TRUE
    ),
    (
        1003,
        'macro|user@user.com',
        'document-with-comments',
        '2022-01-10 14:45:00',
        '2022-01-10 14:45:00',
        NULL,
        false
    ),
    (
        1004,
        'macro|user@user.com',
        'document-with-comments',
        '2022-01-10 14:45:00',
        '2022-01-10 14:45:00',
        '2022-01-10 14:45:00',
        false
    ),
    (
        1005,
        'macro|user@user.com',
        'document-with-comments',
        '2022-01-10 14:45:00',
        '2022-01-10 14:45:00',
        NULL,
        false
    );

-- Create PDF anchors for each thread
INSERT INTO
    public."PdfPlaceableCommentAnchor" (
        "documentId",
        "uuid",
        "owner",
        "page",
        "originalPage",
        "originalIndex",
        "shouldLockOnSave",
        "xPct",
        "yPct",
        "widthPct",
        "heightPct",
        "rotation",
        "threadId",
        "wasEdited",
        "wasDeleted",
        "allowableEdits"
    )
VALUES
    (
        'document-with-comments',
        '91111111-1111-1111-1111-111111111111',
        'macro|user@user.com',
        1,
        1,
        0,
        TRUE,
        0.2,
        0.3,
        0.1,
        0.05,
        0.0,
        1001,
        false,
        false,
        '{"allowResize": true, "allowTranslate": true, "allowRotate": true, "allowDelete": true, "lockAspectRatio": false}'
    ),
    (
        'document-with-comments',
        '81111111-1111-1111-1111-111111111111',
        'macro|user@user.com',
        2,
        2,
        1,
        false,
        0.5,
        0.6,
        0.15,
        0.07,
        0.0,
        1002,
        false,
        false,
        '{"allowResize": true, "allowTranslate": true, "allowRotate": true, "allowDelete": true, "lockAspectRatio": false}'
    ),
    (
        'document-with-comments',
        '71111111-1111-1111-1111-111111111111',
        'macro|user@user.com',
        3,
        3,
        2,
        TRUE,
        0.7,
        0.4,
        0.12,
        0.06,
        0.0,
        1003,
        TRUE,
        false,
        '{"allowResize": true, "allowTranslate": true, "allowRotate": true, "allowDelete": true, "lockAspectRatio": false}'
    );

-- Create comments for each thread
INSERT INTO
    public."Comment" (
        "id",
        "threadId",
        "owner",
        "sender",
        "text",
        "createdAt",
        "updatedAt"
    )
VALUES
    -- Comments for thread 1
    (
        10001,
        1001,
        'macro|user@user.com',
        'user@user.com',
        'Initial question on page 1',
        '2022-01-10 10:00:00',
        '2022-01-10 10:00:00'
    ),
    (
        10002,
        1001,
        'macro|user@user.com',
        'user2@user.com',
        'Response to question on page 1',
        '2022-01-10 10:15:00',
        '2022-01-10 10:15:00'
    ),
    (
        10003,
        1001,
        'macro|user@user.com',
        'user@user.com',
        'Follow up question',
        '2022-01-10 10:30:00',
        '2022-01-10 10:30:00'
    ),  -- Comments for thread 2 (resolved)
    (
        10004,
        1002,
        'macro|user@user.com',
        'user@user.com',
        'Question about diagram on page 2',
        '2022-01-10 11:30:00',
        '2022-01-10 11:30:00'
    ),
    (
        10005,
        1002,
        'macro|user@user.com',
        'user2@user.com',
        'Answer about the diagram',
        '2022-01-10 11:45:00',
        '2022-01-10 11:45:00'
    ),
    (
        10006,
        1002,
        'macro|user@user.com',
        'user@user.com',
        'Thanks, marking as resolved',
        '2022-01-10 12:00:00',
        '2022-01-10 12:00:00'
    ),  -- Comments for thread 3
    (
        10007,
        1003,
        'macro|user2@user.com',
        'user2@user.com',
        'Feedback on page 3',
        '2022-01-10 14:45:00',
        '2022-01-10 14:45:00'
    ),
    (
        10008,
        1005,
        'macro|user@user.com',
        'user@user.com',
        'Comment on page 3',
        '2022-01-10 14:45:00',
        '2022-01-10 14:45:00'
    );

-- Create modification data JSON that matches the thread/comment structure with camelCase
INSERT INTO
    public."DocumentInstanceModificationData" ("documentInstanceId", "modificationData")
VALUES
    (
        100,
        '{
  "placeables": [
    {
      "allowableEdits": {
        "allowResize": true,
        "allowTranslate": true,
        "allowRotate": true,
        "allowDelete": true,
        "lockAspectRatio": false
      },
      "wasEdited": false,
      "wasDeleted": false,
      "pageRange": [1],
      "position": {
        "xPct": 0.2,
        "yPct": 0.3,
        "widthPct": 0.1,
        "heightPct": 0.05,
        "rotation": 0.0
      },
      "shouldLockOnSave": true,
      "originalPage": 1,
      "originalIndex": 0,
      "payloadType": "thread",
      "payload": {
        "headID": "thread1",
        "page": 1,
        "comments": [
          {
            "id": "comment1",
            "sender": "user@user.com",
            "content": "Initial question on page 1",
            "editDate": "2022-01-10T10:00:00Z"
          },
          {
            "id": "comment2",
            "sender": "user2@user.com",
            "content": "Response to question on page 1",
            "editDate": "2022-01-10T10:15:00Z"
          },
          {
            "id": "comment3",
            "sender": "user@user.com",
            "content": "Follow up question",
            "editDate": "2022-01-10T10:30:00Z"
          }
        ],
        "isResolved": false
      }
    },
    {
      "allowableEdits": {
        "allowResize": true,
        "allowTranslate": true,
        "allowRotate": true,
        "allowDelete": true,
        "lockAspectRatio": false
      },
      "wasEdited": false,
      "wasDeleted": false,
      "pageRange": [2],
      "position": {
        "xPct": 0.5,
        "yPct": 0.6,
        "widthPct": 0.15,
        "heightPct": 0.07,
        "rotation": 0.0
      },
      "shouldLockOnSave": false,
      "originalPage": 2,
      "originalIndex": 1,
      "payloadType": "thread",
      "payload": {
        "headID": "thread2",
        "page": 2,
        "comments": [
          {
            "id": "comment4",
            "sender": "user@user.com",
            "content": "Question about diagram on page 2",
            "editDate": "2022-01-10T11:30:00Z"
          },
          {
            "id": "comment5",
            "sender": "user2@user.com",
            "content": "Answer about the diagram",
            "editDate": "2022-01-10T11:45:00Z"
          },
          {
            "id": "comment6",
            "sender": "user@user.com",
            "content": "Thanks, marking as resolved",
            "editDate": "2022-01-10T12:00:00Z"
          }
        ],
        "isResolved": true
      }
    },
    {
      "allowableEdits": {
        "allowResize": true,
        "allowTranslate": true,
        "allowRotate": true,
        "allowDelete": true,
        "lockAspectRatio": false
      },
      "wasEdited": true,
      "wasDeleted": false,
      "pageRange": [3],
      "position": {
        "xPct": 0.7,
        "yPct": 0.4,
        "widthPct": 0.12,
        "heightPct": 0.06,
        "rotation": 0.0
      },
      "shouldLockOnSave": true,
      "originalPage": 3,
      "originalIndex": 2,
      "payloadType": "thread",
      "payload": {
        "headID": "thread3",
        "page": 3,
        "comments": [
          {
            "id": "comment7",
            "sender": "user2@user.com",
            "content": "Feedback on page 3",
            "editDate": "2022-01-10T14:45:00Z"
          }
        ],
        "isResolved": false
      }
    }
  ]
}'
    );

--------------------------------------------------
-- Document for updates
--------------------------------------------------
-- Create another document to test the updates
INSERT INTO
    public."Document" (
        "id",
        "name",
        "fileType",
        "owner",
        "createdAt",
        "updatedAt"
    )
VALUES
    (
        'document-for-updates',
        'Document For Updates',
        'pdf',
        'macro|user@user.com',
        '2022-01-02 00:00:00',
        '2022-01-02 00:00:00'
    );

-- Create document instance for the PDF that will be updated
INSERT INTO
    public."DocumentInstance" (
        "id",
        "documentId",
        "sha",
        "createdAt",
        "updatedAt"
    )
VALUES
    (
        200,
        'document-for-updates',
        'sha-updates',
        '2022-01-02 00:00:00',
        '2022-01-02 00:00:00'
    );

-- Add an initial thread to document-for-updates
INSERT INTO
    public."Thread" (
        "id",
        "owner",
        "documentId",
        "createdAt",
        "updatedAt",
        "resolved"
    )
VALUES
    (
        2001,
        'macro|user@user.com',
        'document-for-updates',
        '2022-01-15 09:00:00',
        '2022-01-15 09:00:00',
        false
    );

-- Create PDF anchor for the thread
INSERT INTO
    public."PdfPlaceableCommentAnchor" (
        "documentId",
        "uuid",
        "owner",
        "page",
        "originalPage",
        "originalIndex",
        "shouldLockOnSave",
        "xPct",
        "yPct",
        "widthPct",
        "heightPct",
        "rotation",
        "threadId",
        "wasEdited",
        "wasDeleted",
        "allowableEdits"
    )
VALUES
    (
        'document-for-updates',
        '61111111-1111-1111-1111-111111111111',
        'macro|user@user.com',
        1,
        1,
        0,
        TRUE,
        0.3,
        0.4,
        0.1,
        0.05,
        0.0,
        2001,
        false,
        false,
        '{"allowResize": true, "allowTranslate": true, "allowRotate": true, "allowDelete": true, "lockAspectRatio": false}'
    );

-- Add comments to thread
INSERT INTO
    public."Comment" (
        "id",
        "threadId",
        "owner",
        "sender",
        "text",
        "createdAt",
        "updatedAt"
    )
VALUES
    (
        20001,
        2001,
        'macro|user@user.com',
        'user@user.com',
        'Initial comment for thread',
        '2022-01-15 09:00:00',
        '2022-01-15 09:00:00'
    );

-- Add consistent modification data with camelCase
INSERT INTO
    public."DocumentInstanceModificationData" ("documentInstanceId", "modificationData")
VALUES
    (
        200,
        '{
  "placeables": [
    {
      "allowableEdits": {
        "allowResize": true,
        "allowTranslate": true,
        "allowRotate": true,
        "allowDelete": true,
        "lockAspectRatio": false
      },
      "wasEdited": false,
      "wasDeleted": false,
      "pageRange": [1],
      "position": {
        "xPct": 0.3,
        "yPct": 0.4,
        "widthPct": 0.1,
        "heightPct": 0.05,
        "rotation": 0.0
      },
      "shouldLockOnSave": true,
      "originalPage": 1,
      "originalIndex": 0,
      "payloadType": "thread",
      "payload": {
        "headID": "update-thread1",
        "page": 1,
        "comments": [
          {
            "id": "update-comment1",
            "sender": "user@user.com",
            "content": "Initial comment for thread",
            "editDate": "2022-01-15T09:00:00Z"
          }
        ],
        "isResolved": false
      }
    }
  ]
}'
    );

--------------------------------------------------
-- Document for deletion tests
--------------------------------------------------
-- Create document that will be used for testing thread deletion
INSERT INTO
    public."Document" (
        "id",
        "name",
        "fileType",
        "owner",
        "createdAt",
        "updatedAt"
    )
VALUES
    (
        'document-delete-test',
        'Document Delete Test',
        'pdf',
        'macro|user@user.com',
        '2022-01-03 00:00:00',
        '2022-01-03 00:00:00'
    );

-- Create document instance for the PDF
INSERT INTO
    public."DocumentInstance" (
        "id",
        "documentId",
        "sha",
        "createdAt",
        "updatedAt"
    )
VALUES
    (
        300,
        'document-delete-test',
        'sha-delete',
        '2022-01-03 00:00:00',
        '2022-01-03 00:00:00'
    );

-- Add threads to document-delete-test
INSERT INTO
    public."Thread" (
        "id",
        "owner",
        "documentId",
        "createdAt",
        "updatedAt",
        "resolved"
    )
VALUES
    (
        3001,
        'macro|user@user.com',
        'document-delete-test',
        '2022-01-20 10:00:00',
        '2022-01-20 10:00:00',
        false
    ),
    (
        3002,
        'macro|user@user.com',
        'document-delete-test',
        '2022-01-20 11:00:00',
        '2022-01-20 11:00:00',
        false
    );

-- Create PDF anchors for the threads
INSERT INTO
    public."PdfPlaceableCommentAnchor" (
        "documentId",
        "uuid",
        "owner",
        "page",
        "originalPage",
        "originalIndex",
        "shouldLockOnSave",
        "xPct",
        "yPct",
        "widthPct",
        "heightPct",
        "rotation",
        "threadId",
        "wasEdited",
        "wasDeleted",
        "allowableEdits"
    )
VALUES
    (
        'document-delete-test',
        '51111111-1111-1111-1111-111111111111',
        'macro|user@user.com',
        1,
        1,
        0,
        TRUE,
        0.2,
        0.3,
        0.1,
        0.05,
        0.0,
        3001,
        false,
        false,
        '{"allowResize": true, "allowTranslate": true, "allowRotate": true, "allowDelete": true, "lockAspectRatio": false}'
    ),
    (
        'document-delete-test',
        '41111111-1111-1111-1111-111111111111',
        'macro|user@user.com',
        2,
        2,
        1,
        TRUE,
        0.5,
        0.6,
        0.15,
        0.07,
        0.0,
        3002,
        false,
        false,
        '{"allowResize": true, "allowTranslate": true, "allowRotate": true, "allowDelete": true, "lockAspectRatio": false}'
    );

-- Add comments to threads
INSERT INTO
    public."Comment" (
        "id",
        "threadId",
        "owner",
        "sender",
        "text",
        "createdAt",
        "updatedAt"
    )
VALUES
    (
        30001,
        3001,
        'macro|user@user.com',
        'user@user.com',
        'Comment in thread 1',
        '2022-01-20 10:00:00',
        '2022-01-20 10:00:00'
    ),
    (
        30002,
        3002,
        'macro|user@user.com',
        'user@user.com',
        'Comment in thread 2',
        '2022-01-20 11:00:00',
        '2022-01-20 11:00:00'
    );

-- Add modification data with only the first thread (to test deletion) with camelCase
INSERT INTO
    public."DocumentInstanceModificationData" ("documentInstanceId", "modificationData")
VALUES
    (
        300,
        '{
  "placeables": [
    {
      "allowableEdits": {
        "allowResize": true,
        "allowTranslate": true,
        "allowRotate": true,
        "allowDelete": true,
        "lockAspectRatio": false
      },
      "wasEdited": false,
      "wasDeleted": false,
      "pageRange": [1],
      "position": {
        "xPct": 0.2,
        "yPct": 0.3,
        "widthPct": 0.1,
        "heightPct": 0.05,
        "rotation": 0.0
      },
      "shouldLockOnSave": true,
      "originalPage": 1,
      "originalIndex": 0,
      "payloadType": "thread",
      "payload": {
        "headID": "delete-thread1",
        "page": 1,
        "comments": [
          {
            "id": "delete-comment1",
            "sender": "user@user.com",
            "content": "Comment in thread 1",
            "editDate": "2022-01-20T10:00:00Z"
          }
        ],
        "isResolved": false
      }
    }
  ]
}'
    );

-- Add highlight anchors (each associated with a thread)
INSERT INTO
    public."PdfHighlightAnchor" (
        "uuid",
        "documentId",
        "owner",
        "threadId",
        "page",
        "red",
        "green",
        "blue",
        "alpha",
        "type",
        "text",
        "pageViewportWidth",
        "pageViewportHeight",
        "createdAt",
        "updatedAt",
        "deletedAt"
    )
VALUES
    -- Highlight 1 (red highlight on page 1, linked to thread 1001)
    (
        '11111111-1111-1111-1111-111111111111',
        'document-with-comments',
        'macro|user@user.com',
        1001,
        1,
        255,
        0,
        0,
        0.8,
        1,
        'Highlighted text on page 1',
        800,
        1000,
        '2022-01-10 10:00:00',
        '2022-01-10 10:00:00',
        NULL
    ),  -- Highlight 2 (green highlight on page 2, linked to thread 1002)
    (
        '22222222-2222-2222-2222-222222222222',
        'document-with-comments',
        'macro|user@user.com',
        1002,
        2,
        0,
        255,
        0,
        0.7,
        1,
        'Another highlight on page 2',
        800,
        1000,
        '2022-01-10 11:30:00',
        '2022-01-10 11:30:00',
        NULL
    ),  -- Highlight 3 (blue highlight on page 3, linked to no thread)
    (
        '33333333-3333-3333-3333-333333333333',
        'document-with-comments',
        'macro|user@user.com',
        NULL,
        3,
        0,
        0,
        255,
        0.6,
        1,
        'Last highlight on page 3',
        800,
        1000,
        '2022-01-10 14:45:00',
        '2022-01-10 14:45:00',
        NULL
    );

-- Add highlight rectangles (each linked to its respective highlight anchor)
INSERT INTO
    public."PdfHighlightRect" (
        "pdfHighlightAnchorId",
        "top",
        "left",
        "width",
        "height"
    )
VALUES
    -- Rectangles for highlight 1 (on page 1)
    (
        '11111111-1111-1111-1111-111111111111',
        100,
        50,
        200,
        50
    ),
    (
        '11111111-1111-1111-1111-111111111111',
        160,
        50,
        200,
        50
    ),  -- Rectangle for highlight 2 (on page 2)
    (
        '22222222-2222-2222-2222-222222222222',
        220,
        80,
        250,
        55
    ),  -- Rectangles for highlight 3 (on page 3)
    (
        '33333333-3333-3333-3333-333333333333',
        300,
        100,
        150,
        40
    ),
    (
        '33333333-3333-3333-3333-333333333333',
        350,
        100,
        150,
        40
    ),
    (
        '33333333-3333-3333-3333-333333333333',
        400,
        100,
        150,
        40
    );

INSERT INTO
    "ThreadAnchor" ("threadId", "anchorId", "anchorTableName")
VALUES
    (
        1001,
        '91111111-1111-1111-1111-111111111111',
        'PdfPlaceableCommentAnchor'
    ),
    (
        1002,
        '81111111-1111-1111-1111-111111111111',
        'PdfPlaceableCommentAnchor'
    ),
    (
        1003,
        '71111111-1111-1111-1111-111111111111',
        'PdfPlaceableCommentAnchor'
    ),
    (
        2001,
        '61111111-1111-1111-1111-111111111111',
        'PdfPlaceableCommentAnchor'
    ),
    (
        3001,
        '51111111-1111-1111-1111-111111111111',
        'PdfPlaceableCommentAnchor'
    ),
    (
        3002,
        '41111111-1111-1111-1111-111111111111',
        'PdfPlaceableCommentAnchor'
    );