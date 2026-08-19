-- Personal, user-owned organization for joined workspace channels.
CREATE TABLE channel_category_layout
(
    user_id  TEXT   PRIMARY KEY REFERENCES "User" (id) ON DELETE CASCADE,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE channel_category
(
    id         UUID        NOT NULL,
    user_id    TEXT        NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    name       TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    sort_order INTEGER     NOT NULL,
    PRIMARY KEY (user_id, id),
    UNIQUE (user_id, sort_order)
);

CREATE TABLE user_channel_placement
(
    user_id     TEXT        NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    channel_id  UUID        NOT NULL REFERENCES comms_channels (id) ON DELETE CASCADE,
    category_id UUID,
    sort_order  INTEGER     NOT NULL,
    PRIMARY KEY (user_id, channel_id),
    FOREIGN KEY (user_id, category_id)
        REFERENCES channel_category (user_id, id) ON DELETE SET NULL (category_id),
    UNIQUE NULLS NOT DISTINCT (user_id, category_id, sort_order)
);
