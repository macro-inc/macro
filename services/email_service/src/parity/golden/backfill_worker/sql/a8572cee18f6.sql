SELECT status::text AS "status!", initialized_at FROM email_backfill_jobs WHERE id = $1
