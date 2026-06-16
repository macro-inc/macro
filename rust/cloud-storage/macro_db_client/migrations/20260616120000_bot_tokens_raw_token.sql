ALTER TABLE public.bot_tokens
    ADD COLUMN token text;

UPDATE public.bot_tokens
SET token = gen_random_uuid()::text
WHERE token IS NULL;

ALTER TABLE public.bot_tokens
    ALTER COLUMN token SET NOT NULL;

DROP INDEX public.bot_tokens_token_prefix_idx;

ALTER TABLE public.bot_tokens
    DROP COLUMN token_hash,
    DROP COLUMN token_prefix;

CREATE UNIQUE INDEX bot_tokens_token_idx
    ON public.bot_tokens (token);
