-- GTM invite links: personal, time-limited signup links created by Macro staff
-- that grant the recipient a promotional first month of Premium.
--
-- User references are Macro user ids (`macro|email`), matching "User".id, so
-- the auth service can attribute links straight from the request principal.
CREATE TABLE public.gtm_invite_link
(
    id                     UUID                     NOT NULL,
    token                  TEXT                     NOT NULL,
    first_name             TEXT                     NOT NULL,
    recipient_email        TEXT,
    note                   TEXT,
    promo_code             TEXT                     NOT NULL,
    created_by_user_id     TEXT                     NOT NULL,
    created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at             TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at             TIMESTAMP WITH TIME ZONE,
    open_count             INTEGER                  NOT NULL DEFAULT 0,
    first_opened_at        TIMESTAMP WITH TIME ZONE,
    redeemed_by_user_id    TEXT,
    redeemed_at            TIMESTAMP WITH TIME ZONE,
    converted_at           TIMESTAMP WITH TIME ZONE,
    stripe_subscription_id TEXT,

    CONSTRAINT gtm_invite_link_pkey PRIMARY KEY (id),
    CONSTRAINT gtm_invite_link_token_key UNIQUE (token),
    CONSTRAINT gtm_invite_link_redemption_consistent
        CHECK ((redeemed_by_user_id IS NULL) = (redeemed_at IS NULL)),
    CONSTRAINT gtm_invite_link_conversion_requires_redemption
        CHECK (converted_at IS NULL OR redeemed_by_user_id IS NOT NULL)
);

-- Dashboard listings: newest first, optionally scoped to the creator.
CREATE INDEX idx_gtm_invite_link_created_by_created_at
    ON public.gtm_invite_link (created_by_user_id, created_at DESC);

CREATE INDEX idx_gtm_invite_link_created_at
    ON public.gtm_invite_link (created_at DESC);

-- A user holds at most one redeemed link.
CREATE UNIQUE INDEX idx_gtm_invite_link_redeemed_by_user_id
    ON public.gtm_invite_link (redeemed_by_user_id)
    WHERE redeemed_by_user_id IS NOT NULL;
