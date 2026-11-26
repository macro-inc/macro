SET LOCAL lock_timeout = '5s';

-- Local eligibility metadata only; old writers keep their existing insert shape.
ALTER TABLE public.email_sync_streams ADD COLUMN parked_at timestamptz;
ALTER TABLE public.email_message_reconciliation ADD COLUMN parked_at timestamptz;
