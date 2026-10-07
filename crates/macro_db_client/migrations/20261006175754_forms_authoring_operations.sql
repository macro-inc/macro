-- Retry records outlive the form so an old request cannot recreate a deleted form.
-- They contain authored configuration, never respondent answers. Account deletion
-- removes them. Form ids are reserved before the form exists, hence no form FK.
CREATE TABLE form_authoring_operations (
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    command JSONB NOT NULL,
    operation JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, request_id)
);
