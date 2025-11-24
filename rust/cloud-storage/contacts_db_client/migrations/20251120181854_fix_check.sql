-- Drop the existing CHECK constraint
ALTER TABLE connections DROP CONSTRAINT connections_check;

-- Add the new CHECK constraint with binary collation
ALTER TABLE connections ADD CONSTRAINT connections_check
    CHECK (user1 <= user2 COLLATE "C");
