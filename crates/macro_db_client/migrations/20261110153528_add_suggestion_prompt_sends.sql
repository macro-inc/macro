-- What a background prompt suggestion's run will post or send, and where, in the
-- suggestion's own words: the card shows it before Run, and running the suggestion
-- approves exactly that. Empty when the run posts and sends nothing.
SET LOCAL lock_timeout = '5s';
ALTER TABLE suggestion_prompt ADD COLUMN sends text;
