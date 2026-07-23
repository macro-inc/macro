# Teams crate

This crate owns team models, persistence ports, service policy, and HTTP adapters.
The team service also produces sanitized lifecycle, invitation, and membership
events for successful team mutations.

## Team event producer

The events below use schema version 1 and are published to the `macro.teams`
Kafka topic. Every record uses the subject team's bare UUID string as its Kafka
key (for example, `3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90`, without a `team|`
prefix). The key is not part of the JSON envelope. Events for one team
therefore use the same Kafka partition and retain per-team ordering; ordering
between different teams is unspecified.

| Event name | Emitted after | Metadata |
| --- | --- | --- |
| `team.created` | Team creation and all rollback-capable creation side effects succeed | `team_id`, `name`, `slug`, `owner`, `enterprise`, `paid`, `auto_join_domain` |
| `team.updated` | A team PATCH containing `name` or `slug` is persisted | `team_id`, `actor_user_id`, requested `name`, requested `slug` |
| `team.deleted` | Team deletion succeeds | `team_id`, `actor_user_id`, `member_user_ids` |
| `team.invite_created` | A new invite is persisted; one event is produced per newly invited lowercase email | `team_id`, `invite_id`, `email`, `invited_by`, `team_name` |
| `team.invite_rejected` | The invitee successfully rejects and deletes an invite | `team_id`, `invite_id`, `email`, `actor_user_id` |
| `team.invite_revoked` | An administrator successfully deletes an invite | `team_id`, `invite_id`, `email`, `actor_user_id` |
| `team.member_joined` | An invited or domain-auto-joined membership and all rollback-capable side effects succeed | `team_id`, `member_id`, `role`, `join_method` |
| `team.member_removed` | Membership removal and all rollback-capable side effects succeed | `team_id`, `member_id`, `removed_by`, `role` |
| `team.member_role_changed` | Each individual member role update succeeds | `team_id`, `actor_user_id`, `member_id`, `role`, `previous_role` |
| `team.auto_join_domain_toggled` | An explicit auto-join-domain toggle succeeds | `team_id`, `actor_user_id`, `auto_join_domain` |

Roles are lowercase (`member`, `admin`, or `owner`). Optional metadata is
serialized as `null`: the mutable fields on an updated event describe the
requested PATCH, and `null` means that field was omitted. `team_name` is a
best-effort invite-time lookup. `previous_role` is the role in the pre-PATCH
team snapshot when known. `auto_join_domain` is the resulting domain or `null`
when disabled. Team deletion produces one event whose `member_user_ids` lists
the members present before deletion; it does not produce an individual removal
event for every member. For self-service removal, `removed_by` equals
`member_id`.

The automatic domain toggle performed during creation is represented only by
`auto_join_domain` on the created event. The explicit settings operation
produces the toggle event. A role-only PATCH produces role-change events but no
updated event. Role updates are committed in request order: if a later update
fails, earlier successful updates and their events remain committed, while no
event is produced for the failed update.

`join_method` is a tagged union. An accepted invite includes its invite UUID and
the inviter; a domain auto-join is encoded as `{"type":"domain_auto_join"}`.
A complete invite-accepted membership envelope has this shape:

```json
{
  "event_id": "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
  "schema_version": 1,
  "event_type": "team.member_joined",
  "metadata": {
    "team_id": "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90",
    "member_id": "macro|joiner@acme.com",
    "role": "member",
    "join_method": {
      "type": "invite_accepted",
      "invite_id": "0197f776-6e7b-7c69-a251-780ae754d3e4",
      "invited_by": "macro|admin@acme.com"
    }
  }
}
```

## Sanitization and excluded flows

Event payloads exclude Stripe subscription IDs, customer IDs, payment state,
and all other billing identifiers. The only billing-derived value is the
`paid: bool` field on creation.

Only the successful mutations in the table produce these events. Billing flows,
including Stripe-webhook subscription and payment-status changes and premium
role revocation or restoration, do not publish them. CRM-setting changes,
read/list operations, invite resends and their `mark_invites_sent` updates, and
notification outcomes also do not publish team events. Best-effort CRM,
contact, and notification work after a committed mutation does not suppress the
corresponding event.

This change provides production only. It adds no team-event consumer, and the
webhook Kafka consumer and webhook delivery pipeline do not consume or deliver
these events.

## Delivery semantics and compatibility

Publication occurs after the relevant committed mutation and is
fire-and-forget. The API does not wait for Kafka delivery, and a scheduling or
publication failure is logged without rolling back or failing an otherwise
successful request. There is no transaction, outbox, or retry coupling database
persistence to publication. Delivery is therefore at-most-once relative to team
mutations: a committed mutation can have no corresponding event.

Consumers must tolerate unknown `event_type` values and unknown metadata fields
so new event variants and additive fields remain forward compatible. Consumers
should use `schema_version` when interpreting a known event; every event in this
contract currently uses version 1.

Provision the `macro.teams` topic before deploying the producer. The rollout
order is: deploy the Kafka-cluster stack, configure `KAFKA_BROKERS` for the
authentication service in Doppler, then deploy the authentication service. If
the producer is deployed before the topic is available, team mutations still
succeed, but events can be lost under the at-most-once contract.
