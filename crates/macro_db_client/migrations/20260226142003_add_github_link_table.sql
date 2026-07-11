-- Add migration script here
CREATE TABLE public.github_links
(
    id                 UUID                     NOT NULL,
    macro_id           TEXT                     NOT NULL REFERENCES "User" ("id") ON DELETE CASCADE,
    fusionauth_user_id UUID                     NOT NULL,
    github_username    VARCHAR(255)             NOT NULL,
    github_user_id     TEXT                     NOT NULL,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

    CONSTRAINT github_links_pkey PRIMARY KEY (id)
);

-- Prevent GitHub account sharing across users
CREATE UNIQUE INDEX uq_github_links_github_user_id
    ON public.github_links (github_user_id);

-- Lookup indices
CREATE INDEX idx_github_links_macro_id
    ON public.github_links (macro_id);

CREATE INDEX idx_github_links_fusionauth_user_id
    ON public.github_links(fusionauth_user_id);

CREATE INDEX idx_github_links_github_username
    ON public.github_links (github_username);
