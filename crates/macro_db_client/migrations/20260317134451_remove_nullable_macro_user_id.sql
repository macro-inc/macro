-- Add migration script here
ALTER TABLE "User" ALTER COLUMN macro_user_id SET NOT NULL;
