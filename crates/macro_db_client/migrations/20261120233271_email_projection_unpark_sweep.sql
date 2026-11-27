SET LOCAL lock_timeout = '5s';

-- Each bounded page holds this singleton row lock through its cursor commit.
-- Crash rollback releases ownership without losing the saved position.
CREATE TABLE public.email_projection_unpark_sweep (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    link_after uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    available_at timestamptz NOT NULL DEFAULT now(),
    last_completed_at timestamptz,
    links_scanned bigint NOT NULL DEFAULT 0,
    rows_unparked bigint NOT NULL DEFAULT 0
);
INSERT INTO public.email_projection_unpark_sweep (id) VALUES (true);
