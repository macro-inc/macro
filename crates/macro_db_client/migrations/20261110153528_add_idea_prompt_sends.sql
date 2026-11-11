-- What a background prompt idea's run will post or send, and where, in the
-- idea's own words: the card shows it before Run, and running the idea
-- approves exactly that. Empty when the run posts and sends nothing.
SET LOCAL lock_timeout = '5s';
ALTER TABLE idea_prompt ADD COLUMN sends text;
