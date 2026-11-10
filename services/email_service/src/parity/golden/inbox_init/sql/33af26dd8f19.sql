SELECT id FROM "User" WHERE lower(email) = lower($1)
