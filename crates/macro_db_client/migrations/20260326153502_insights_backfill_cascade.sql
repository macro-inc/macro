-- Add migration script here
ALTER TABLE public."EmailInsightsBackfillJob"
    DROP CONSTRAINT "EmailInsightsBackfillJob_userId_fkey",
    ADD CONSTRAINT "EmailInsightsBackfillJob_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES public."User"(id)
            ON UPDATE CASCADE ON DELETE CASCADE;