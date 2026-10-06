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
-- Baselines expire after a day and are pruned on the next authoring read for
-- that actor. Permanent deletion immediately removes their draft content.
CREATE TABLE form_authoring_baselines (
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    revision_id UUID NOT NULL,
    form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    snapshot JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 day',
    PRIMARY KEY (user_id, revision_id)
);
CREATE INDEX form_authoring_baselines_form ON form_authoring_baselines(form_id);
