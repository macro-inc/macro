-- Retire storage with no remaining application readers/writers. The 2026-10-15
-- audit checked macro-api's GraphQL service, the deployed monorepo revision
-- 00a71cd7d651216e4913bd5c2b66fb1954dea3cd, and the absence of insight-service
-- workloads/schedules in production. Historical insight data is intentionally
-- discarded; the organization/enterprise tables still used by macro-api stay.
--
-- Do not use CASCADE: an unexpected external dependency must block this drop.
SET LOCAL lock_timeout = '5s';

DROP TABLE "WebsocketConnectionPermissions";
DROP TABLE "MacroPromptAttachment";
DROP TABLE "Artifact";

-- Drop the backfill child before its parent.
DROP TABLE "EmailInsightsBackfillBatch";
DROP TABLE "EmailInsightsBackfillJob";
DROP TABLE "DocumentSummary";
DROP TABLE "UserInsightBatch";
DROP TABLE "UserInsights";
DROP TABLE "InsightContext";
