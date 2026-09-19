ALTER TABLE public.bot_tokens
    ADD COLUMN token_hash bytea,
    ADD COLUMN token_prefix text;

UPDATE public.bot_tokens
SET
    token_hash = digest(convert_to(token, 'UTF8'), 'sha256'),
    token_prefix = CASE
        WHEN token LIKE 'mbot\_%' ESCAPE '\'
             AND split_part(token, '_', 2) <> ''
            THEN 'mbot_' || split_part(token, '_', 2)
        ELSE left(token, 12)
    END
WHERE token_hash IS NULL
   OR token_prefix IS NULL;

ALTER TABLE public.bot_tokens
    ALTER COLUMN token_hash SET NOT NULL,
    ALTER COLUMN token_prefix SET NOT NULL;

CREATE UNIQUE INDEX bot_tokens_token_hash_idx
    ON public.bot_tokens (token_hash);

DROP INDEX public.bot_tokens_token_idx;

ALTER TABLE public.bot_tokens
    DROP COLUMN token;
