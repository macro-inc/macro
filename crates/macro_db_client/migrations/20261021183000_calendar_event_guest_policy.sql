-- Google's organizer-set guest permissions on the entity row.
--
-- An organizer decides whether guests may modify the event, invite others,
-- and see the guest list. Google omits each switch while it holds its
-- default, so the columns default to Google's values (off, on, on) and an
-- event synced before these columns existed reads as the default until its
-- next sync. The canonical source's projection writes them, like the other
-- content columns.

SET lock_timeout = '5s';

ALTER TABLE calendar_events
    ADD COLUMN guests_can_modify boolean NOT NULL DEFAULT false,
    ADD COLUMN guests_can_invite_others boolean NOT NULL DEFAULT true,
    ADD COLUMN guests_can_see_other_guests boolean NOT NULL DEFAULT true;
