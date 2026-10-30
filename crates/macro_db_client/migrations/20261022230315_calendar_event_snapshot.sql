-- Whether an event is Macro's snapshot of a shared meeting.
--
-- Adding a channel-shared event to a calendar imports a private copy of the
-- meeting, listing the calendar's owner as its only guest so Google accepts
-- it. The copy carries a private marker that sync reads back into this
-- column, and the capability model grants nothing on such a copy: an answer
-- or a new guest would never reach the meeting. The canonical source's
-- projection writes it, like the other content columns.

SET lock_timeout = '5s';

ALTER TABLE calendar_events
    ADD COLUMN is_snapshot boolean NOT NULL DEFAULT false;
