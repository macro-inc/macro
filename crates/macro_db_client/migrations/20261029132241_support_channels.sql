-- Mark the private support channel created for each new user, so the Macro
-- team members in it can list support channels apart from their own channels.
SET LOCAL lock_timeout = '5s';

ALTER TABLE comms_channels
    ADD COLUMN is_support boolean NOT NULL DEFAULT false;

-- Signup has always named these channels "Macro Support x <email local part>".
UPDATE comms_channels
SET is_support = true
WHERE channel_type = 'private'
  AND name LIKE 'Macro Support x %';
