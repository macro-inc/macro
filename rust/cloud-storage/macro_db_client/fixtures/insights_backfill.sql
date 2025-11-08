-- Create test user for insights backfill
INSERT INTO
    public."User" ("id", "email", "stripeCustomerId")
VALUES
    (
        'test-user-1',
        'test@example.com',
        'stripe_test_id'
    );

-- Create test insights backfill job
INSERT INTO
    public."EmailInsightsBackfillJob" (
        "id",
        "userId",
        "threadsProcessedCount",
        "insightsGeneratedCount",
        "status",
        "completedAt",
        "createdAt",
        "updatedAt"
    )
VALUES
    (
        'test-job-1',
        'test-user-1',
        25,
        10,
        'InProgress' :: "insights_backfill_job_status",
        NULL,
        '2024-01-01 09:00:00+00' :: timestamptz,
        '2024-01-01 10:30:00+00' :: timestamptz
    ),
    (
        'test-job-2',
        'test-user-1',
        0,
        0,
        'Init' :: "insights_backfill_job_status",
        NULL,
        '2024-01-01 11:00:00+00' :: timestamptz,
        '2024-01-01 11:00:00+00' :: timestamptz
    ),
    (
        'test-job-complete',
        'test-user-1',
        10,
        5,
        'Complete' :: "insights_backfill_job_status",
        '2024-01-01 08:30:00+00' :: timestamptz,
        '2024-01-01 07:00:00+00' :: timestamptz,
        '2024-01-01 08:30:00+00' :: timestamptz
    );

-- Create test insights backfill batches
INSERT INTO
    public."EmailInsightsBackfillBatch" (
        "id",
        "insightsBackfillJobId",
        "sqsMessageId",
        "threadIds",
        "totalThreads",
        "status",
        "insightsGeneratedCount",
        "insightIds",
        "errorMessage",
        "queuedAt",
        "startedAt",
        "completedAt",
        "createdAt",
        "updatedAt"
    )
VALUES
    (
        'test-batch-1',
        'test-job-1',
        'sqs-msg-id-1',
        '{"thread1", "thread2", "thread3"}',
        3,
        'Complete' :: "insights_backfill_batch_status",
        5,
        '{"insight-1", "insight-2", "insight-3", "insight-4", "insight-5"}',
        NULL,
        '2024-01-01 10:00:00+00' :: timestamptz,
        '2024-01-01 10:05:00+00' :: timestamptz,
        '2024-01-01 10:15:00+00' :: timestamptz,
        '2024-01-01 09:30:00+00' :: timestamptz,
        '2024-01-01 10:15:00+00' :: timestamptz
    ),
    (
        'test-batch-2',
        'test-job-1',
        NULL,
        '{"thread4", "thread5"}',
        2,
        'InProgress' :: "insights_backfill_batch_status",
        0,
        NULL,
        NULL,
        '2024-01-01 10:20:00+00' :: timestamptz,
        '2024-01-01 10:25:00+00' :: timestamptz,
        NULL,
        '2024-01-01 10:15:00+00' :: timestamptz,
        '2024-01-01 10:25:00+00' :: timestamptz
    ),
    (
        'test-batch-failed',
        'test-job-2',
        'sqs-msg-id-failed',
        '{"thread6"}',
        1,
        'Failed' :: "insights_backfill_batch_status",
        0,
        NULL,
        'Processing error occurred',
        '2024-01-01 11:00:00+00' :: timestamptz,
        '2024-01-01 11:05:00+00' :: timestamptz,
        '2024-01-01 11:10:00+00' :: timestamptz,
        '2024-01-01 10:50:00+00' :: timestamptz,
        '2024-01-01 11:10:00+00' :: timestamptz
    ),
    (
        'test-batch-queued',
        'test-job-2',
        NULL,
        '{"thread7", "thread8"}',
        2,
        'Queued' :: "insights_backfill_batch_status",
        0,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        '2024-01-01 11:30:00+00' :: timestamptz,
        '2024-01-01 11:30:00+00' :: timestamptz
    );

