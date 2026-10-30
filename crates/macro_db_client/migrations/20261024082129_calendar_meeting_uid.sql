-- Exchange gives a meeting it imports from an iCalendar invitation its own UID:
-- a hex GlobalObjectId whose data wraps the original UID after "vCal-Uid" and a
-- version word, NUL-terminated. Unwrapping it pairs an Outlook copy of a Google
-- meeting with that meeting's Google copies. Only printable ASCII other than a
-- backslash is unwrapped, so the escape encoding returns the UID unchanged.
CREATE OR REPLACE FUNCTION calendar_meeting_uid(uid text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
        SELECT CASE
            WHEN uid ~* '^040000008200E00074C5B7101A82E008[0-9A-F]{48}7643616C2D55696401000000([2-46][0-9A-F]|5[0-9ABD-F]|7[0-9A-E])+00$'
            THEN encode(decode(substr(uid, 105, length(uid) - 106), 'hex'), 'escape')
            ELSE uid
        END
    $$;
