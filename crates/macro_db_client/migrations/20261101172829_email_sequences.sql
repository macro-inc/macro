-- Email sequences (crate `email_sequences`): multi-step outreach a user sends
-- from their own Gmail inbox to their team's CRM contacts. The sweep creates at
-- most one unsent step per enrollment, through the scheduled-send pipeline.
--
-- Cleanup: users and teams cascade to their sequences, enrollments, step
-- history and the team's unsubscribe list; a deleted inbox or CRM contact
-- leaves its enrollments with a NULL reference. Unsent steps left without
-- history are withdrawn by the sweep.

CREATE TABLE email_sequences (
    id uuid PRIMARY KEY,
    team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    link_id uuid REFERENCES email_links(id) ON DELETE SET NULL,
    name text NOT NULL,
    footer text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
    steps jsonb NOT NULL DEFAULT '[]',
    version integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_sequences_user_id_idx ON email_sequences (user_id);

-- One row per address a team's sequences have written to. The token is the
-- credential in every unsubscribe link and header, and outlives sequences.
CREATE TABLE email_sequence_recipients (
    team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    email text NOT NULL,
    token text NOT NULL UNIQUE,
    unsubscribed_at timestamptz,
    source text CHECK (source IN ('link', 'manual')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, email),
    CHECK ((unsubscribed_at IS NULL) = (source IS NULL))
);

CREATE TABLE email_sequence_enrollments (
    id uuid PRIMARY KEY,
    sequence_id uuid NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
    team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    link_id uuid REFERENCES email_links(id) ON DELETE SET NULL,
    crm_contact_id uuid REFERENCES crm_contacts(id) ON DELETE SET NULL,
    email text NOT NULL,
    contact_name text,
    -- The steps rendered for this contact when enrolled.
    steps jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'paused', 'needs_attention', 'stopped', 'completed')),
    reason text CHECK (reason IN ('manual', 'replied', 'bounced', 'unsubscribed', 'access_lost',
        'inbox_unavailable', 'step_failed', 'step_withdrawn', 'step_unknown', 'step_stuck')),
    next_step smallint NOT NULL DEFAULT 0 CHECK (next_step >= 0),
    due_at timestamptz,
    attempts smallint NOT NULL DEFAULT 0,
    timezone text NOT NULL,
    send_time time NOT NULL,
    -- Incoming mail after this can stop the enrollment.
    replies_after timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sequence_id, email),
    CHECK ((status IN ('stopped', 'needs_attention')) = (reason IS NOT NULL))
);

CREATE INDEX email_sequence_enrollments_due_idx ON email_sequence_enrollments (due_at, id)
    WHERE status = 'active' AND due_at IS NOT NULL;
CREATE INDEX email_sequence_enrollments_live_idx ON email_sequence_enrollments (link_id, email)
    WHERE status IN ('active', 'paused', 'needs_attention');
CREATE INDEX email_sequence_enrollments_team_email_idx ON email_sequence_enrollments (team_id, email);
-- CRM deletes contacts in bulk; each delete sets references here to NULL.
CREATE INDEX email_sequence_enrollments_crm_contact_idx ON email_sequence_enrollments (crm_contact_id)
    WHERE crm_contact_id IS NOT NULL;

-- What happened to each step's email. No foreign key to email_messages: an
-- inbox deletion removes its messages and the history must survive it.
CREATE TABLE email_sequence_steps (
    enrollment_id uuid NOT NULL REFERENCES email_sequence_enrollments(id) ON DELETE CASCADE,
    step smallint NOT NULL,
    message_id uuid NOT NULL UNIQUE,
    delivery_message_id text,
    provider_message_id text,
    status text NOT NULL CHECK (status IN ('scheduled', 'sent', 'unknown')),
    scheduled_at timestamptz NOT NULL,
    sent_at timestamptz,
    PRIMARY KEY (enrollment_id, step)
);

-- At most one unsent step per enrollment.
CREATE UNIQUE INDEX email_sequence_steps_one_unsent_idx ON email_sequence_steps (enrollment_id)
    WHERE status = 'scheduled';
CREATE INDEX email_sequence_steps_delivery_idx ON email_sequence_steps (delivery_message_id)
    WHERE delivery_message_id IS NOT NULL;
CREATE INDEX email_sequence_steps_provider_idx ON email_sequence_steps (provider_message_id)
    WHERE provider_message_id IS NOT NULL;
