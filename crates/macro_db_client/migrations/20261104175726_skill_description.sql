-- When to use a skill, in one line ("Use when ...; not ..."). Agents route
-- requests to skills on it, so it is kept apart from the skill's body. A skill
-- created before descriptions existed has no row and routes by its name.
CREATE TABLE "skill_description"
(
    "document_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "skill_description_pkey" PRIMARY KEY ("document_id"),
    CONSTRAINT "skill_description_document_id_fkey" FOREIGN KEY ("document_id")
        REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "skill_description_length" CHECK (char_length("description") BETWEEN 1 AND 300)
);
