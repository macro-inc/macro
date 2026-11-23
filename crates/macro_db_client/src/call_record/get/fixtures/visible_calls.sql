-- Every way a call can be visible or hidden to the viewer.
--
-- Viewer: active member of channel ...c1, left channel ...c2, never in ...c3;
-- in team ...a1 with the teammate. The other owner is in team ...a2; the
-- owner has no team.
BEGIN;
SET LOCAL session_replication_role = 'replica';

INSERT INTO team_user (user_id, team_id, team_role) VALUES
    ('macro|visible-viewer@example.test', '00000000-0000-0000-0000-0000000000a1', 'member'),
    ('macro|visible-teammate@example.test', '00000000-0000-0000-0000-0000000000a1', 'member'),
    ('macro|visible-other-owner@example.test', '00000000-0000-0000-0000-0000000000a2', 'member');

INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at) VALUES
    ('00000000-0000-0000-0000-0000000000c1', 'member', 'macro|visible-viewer@example.test', NULL),
    ('00000000-0000-0000-0000-0000000000c2', 'member', 'macro|visible-viewer@example.test', now()),
    ('00000000-0000-0000-0000-0000000000c1', 'member', 'macro|visible-owner@example.test', NULL);

INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel") VALUES
    ('sp-visible-plain', NULL, NULL),
    ('sp-visible-public', 'PUBLIC', 'view'),
    ('sp-visible-team', 'TEAM', 'view'),
    ('sp-visible-public-no-level', 'PUBLIC', NULL);

-- ca01-ca06 channel calls reached through grants, ca11-ca16 standalone calls,
-- ca21-ca22 public link shares, ca31-ca34 team link shares, ca41-ca42 other
-- grants. Share permissions are shared between calls only to keep this short.
INSERT INTO call_records (id, channel_id, room_name, created_by, started_at, ended_at, duration_ms, share_permission_id) VALUES
    ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000000c1', 'g1', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-0000000000c1', 'g2', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca03', '00000000-0000-0000-0000-0000000000c3', 'g3', 'macro|visible-teammate@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca04', '00000000-0000-0000-0000-0000000000c2', 'g4', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca05', '00000000-0000-0000-0000-0000000000c2', 'g5', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca06', '00000000-0000-0000-0000-0000000000c3', 'g6', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca11', NULL, 's1', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca12', NULL, 's2', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca13', NULL, 's3', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca14', NULL, 's4', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca15', NULL, 's5', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-public'),
    ('00000000-0000-0000-0000-00000000ca16', NULL, 's6', 'macro|visible-viewer@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca21', '00000000-0000-0000-0000-0000000000c3', 'p1', 'macro|visible-other-owner@example.test', now(), now(), 0, 'sp-visible-public'),
    ('00000000-0000-0000-0000-00000000ca22', '00000000-0000-0000-0000-0000000000c1', 'p2', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-public'),
    ('00000000-0000-0000-0000-00000000ca31', '00000000-0000-0000-0000-0000000000c3', 't1', 'macro|visible-teammate@example.test', now(), now(), 0, 'sp-visible-team'),
    ('00000000-0000-0000-0000-00000000ca32', '00000000-0000-0000-0000-0000000000c3', 't2', 'macro|visible-other-owner@example.test', now(), now(), 0, 'sp-visible-team'),
    ('00000000-0000-0000-0000-00000000ca33', '00000000-0000-0000-0000-0000000000c3', 't3', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-team'),
    ('00000000-0000-0000-0000-00000000ca34', '00000000-0000-0000-0000-0000000000c3', 't4', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-public-no-level'),
    ('00000000-0000-0000-0000-00000000ca41', '00000000-0000-0000-0000-0000000000c3', 'x1', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-plain'),
    ('00000000-0000-0000-0000-00000000ca42', '00000000-0000-0000-0000-0000000000c3', 'o1', 'macro|visible-owner@example.test', now(), now(), 0, 'sp-visible-plain');

INSERT INTO call_record_participants (call_record_id, user_id, joined_at) VALUES
    ('00000000-0000-0000-0000-00000000ca01', 'macro|visible-viewer@example.test', now()),
    ('00000000-0000-0000-0000-00000000ca06', 'macro|visible-viewer@example.test', now()),
    ('00000000-0000-0000-0000-00000000ca16', 'macro|visible-viewer@example.test', now()),
    ('00000000-0000-0000-0000-00000000ca02', 'macro|visible-owner@example.test', now());

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
    -- Channel grant from a channel the viewer is in.
    ('00000000-0000-0000-0000-00000000ca01', 'call', '00000000-0000-0000-0000-0000000000c1', 'channel', 'view'),
    ('00000000-0000-0000-0000-00000000ca02', 'call', '00000000-0000-0000-0000-0000000000c1', 'channel', 'view'),
    -- Team grant.
    ('00000000-0000-0000-0000-00000000ca03', 'call', '00000000-0000-0000-0000-0000000000a1', 'team', 'view'),
    -- Channel grant from a channel the viewer left: hidden.
    ('00000000-0000-0000-0000-00000000ca04', 'call', '00000000-0000-0000-0000-0000000000c2', 'channel', 'view'),
    -- The same, plus the viewer's own grant: visible.
    ('00000000-0000-0000-0000-00000000ca05', 'call', '00000000-0000-0000-0000-0000000000c2', 'channel', 'view'),
    ('00000000-0000-0000-0000-00000000ca05', 'call', 'macro|visible-viewer@example.test', 'user', 'view'),
    -- Reached through three of the viewer's sources: listed once.
    ('00000000-0000-0000-0000-00000000ca06', 'call', '00000000-0000-0000-0000-0000000000c3', 'channel', 'view'),
    ('00000000-0000-0000-0000-00000000ca06', 'call', '00000000-0000-0000-0000-0000000000a1', 'team', 'view'),
    ('00000000-0000-0000-0000-00000000ca06', 'call', 'macro|visible-viewer@example.test', 'user', 'view'),
    -- Standalone: the viewer's own grant counts, group grants do not.
    ('00000000-0000-0000-0000-00000000ca11', 'call', 'macro|visible-owner@example.test', 'user', 'owner'),
    ('00000000-0000-0000-0000-00000000ca11', 'call', 'macro|visible-viewer@example.test', 'user', 'view'),
    ('00000000-0000-0000-0000-00000000ca12', 'call', '00000000-0000-0000-0000-0000000000a1', 'team', 'view'),
    ('00000000-0000-0000-0000-00000000ca13', 'call', '00000000-0000-0000-0000-0000000000c1', 'channel', 'view'),
    ('00000000-0000-0000-0000-00000000ca14', 'call', 'macro|visible-viewer@example.test', 'team', 'view'),
    ('00000000-0000-0000-0000-00000000ca15', 'call', 'macro|visible-owner@example.test', 'user', 'owner'),
    ('00000000-0000-0000-0000-00000000ca16', 'call', 'macro|visible-viewer@example.test', 'user', 'owner'),
    -- A public channel call the viewer also holds a grant on: listed once.
    ('00000000-0000-0000-0000-00000000ca22', 'call', '00000000-0000-0000-0000-0000000000c1', 'channel', 'view'),
    -- A grant on another entity type that carries a call's id.
    ('00000000-0000-0000-0000-00000000ca41', 'document', 'macro|visible-viewer@example.test', 'user', 'view'),
    -- Another user's grant.
    ('00000000-0000-0000-0000-00000000ca42', 'call', 'macro|visible-other-owner@example.test', 'user', 'owner'),
    -- A grant on a call with no archived record.
    ('00000000-0000-0000-0000-00000000ca43', 'call', 'macro|visible-viewer@example.test', 'user', 'owner');

COMMIT;
