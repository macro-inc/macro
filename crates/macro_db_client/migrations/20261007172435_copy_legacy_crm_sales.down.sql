-- The copy may already contain user edits. Never delete it or allow the runner
-- to forget completion and create duplicate Sales pipelines on the next deploy.
DO $$ BEGIN
    RAISE EXCEPTION 'The Sales data copy is forward-only; keep its migration record and pipeline data';
END $$;
