-- Reserve page space so eligible email_threads updates can remain HOT.
-- This reloption change does not rewrite existing table pages; do not run a
-- table rewrite or VACUUM FULL as part of deployment.
ALTER TABLE email_threads SET (fillfactor = 85);
