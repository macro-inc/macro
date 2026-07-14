CREATE TYPE entity_access_source_type AS ENUM ('channel', 'team', 'user');

CREATE TABLE entity_access
(
    id BIGSERIAL PRIMARY KEY,
    entity_id UUID NOT NULL,
    entity_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_type entity_access_source_type NOT NULL,
    access_level "AccessLevel" NOT NULL,
    granted_from_project_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure project deletion automatically cleans up all access granted from a given project
ALTER TABLE "entity_access"
    ADD CONSTRAINT "entity_access_granted_from_project_id_fkey"
    FOREIGN KEY ("granted_from_project_id") REFERENCES "Project" ("id") ON DELETE CASCADE;

-- Fast lookup on entity id + type
CREATE INDEX "entity_access_entity_id_entity_type_idx"
    ON entity_access ("entity_id", "entity_type");

-- Fast lookup on source_id
CREATE INDEX "entity_access_source_id_idx"
    ON entity_access ("source_id");

-- Fast lookup based on project_id
CREATE INDEX "entity_access_granted_from_project_id_idx"
    ON entity_access ("granted_from_project_id");

-- Uniqueness for records with a granted_from_project_id
CREATE UNIQUE INDEX "entity_access_unique_with_project"
    ON entity_access ("entity_id", "entity_type", "source_id", "source_type", "granted_from_project_id")
    WHERE "granted_from_project_id" IS NOT NULL;

-- Uniqueness for records without a granted_from_project_id (e.g. creator/owner entries)
CREATE UNIQUE INDEX "entity_access_unique_without_project"
    ON entity_access ("entity_id", "entity_type", "source_id", "source_type")
    WHERE "granted_from_project_id" IS NULL;
