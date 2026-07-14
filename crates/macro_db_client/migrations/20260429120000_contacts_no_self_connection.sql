DELETE FROM contacts_connections WHERE user1 = user2;

ALTER TABLE contacts_connections
    DROP CONSTRAINT contacts_connections_check,
    ADD CONSTRAINT contacts_connections_user1_user2_check CHECK (user1 < user2 COLLATE "C");
