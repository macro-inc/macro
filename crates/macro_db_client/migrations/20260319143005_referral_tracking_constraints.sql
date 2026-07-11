ALTER TABLE public.referral_tracking
  ADD CONSTRAINT referral_tracking_no_self_referral CHECK (referrer_id != referred_id);
