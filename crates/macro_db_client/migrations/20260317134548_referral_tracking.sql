-- Add migration script here
CREATE TABLE public.referral_tracking
(
    id                 UUID                     NOT NULL,
    referrer_id        UUID                     NOT NULL,
    referred_id        UUID                     NOT NULL,
    status             TEXT                     NOT NULL,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

    CONSTRAINT referral_tracking_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_referral_tracking_referrer_id
  ON referral_tracking (referrer_id);


CREATE UNIQUE INDEX idx_referral_tracking_referred_id
  ON referral_tracking (referred_id);
