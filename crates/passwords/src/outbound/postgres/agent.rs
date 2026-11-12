//! Agent access persistence. Grant, approval, request, audit and outbox changes
//! commit in one transaction; values never cross this adapter.
use super::*;
use crate::domain::agent::{
    AgentAccessRow, AgentAction, StoredRequest, StoredRequestStatus,
    ports::{
        AccessEvent, AccessTransition, AgentAudit, AgentRepository, EnrollmentState, Expected,
        IntentAgent, NewRequest, PendingRequest, RequestOutcome,
    },
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgConnection;

const UNDELIVERED_BATCH: i64 = 100;

fn user(id: String) -> Result<MacroUserIdStr<'static>, Error> {
    MacroUserIdStr::parse_from_str(&id)
        .map(CowLike::into_owned)
        .map_err(|_| Error::Unavailable)
}

fn status_text(status: StoredRequestStatus) -> &'static str {
    match status {
        StoredRequestStatus::Pending => "pending",
        StoredRequestStatus::Approved => "approved",
        StoredRequestStatus::Denied => "denied",
        StoredRequestStatus::Revoked => "revoked",
    }
}

fn status(text: &str) -> Result<StoredRequestStatus, Error> {
    match text {
        "pending" => Ok(StoredRequestStatus::Pending),
        "approved" => Ok(StoredRequestStatus::Approved),
        "denied" => Ok(StoredRequestStatus::Denied),
        "revoked" => Ok(StoredRequestStatus::Revoked),
        _ => Err(Error::Unavailable),
    }
}

fn permission_text(permission: Permission) -> &'static str {
    match permission {
        Permission::View => "view",
        Permission::Edit => "edit",
    }
}

fn permission(text: &str) -> Result<Permission, Error> {
    match text {
        "view" => Ok(Permission::View),
        "edit" => Ok(Permission::Edit),
        _ => Err(Error::Unavailable),
    }
}

fn action_text(action: AgentAction) -> Result<String, Error> {
    serde_json::to_value(action)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or(Error::Invalid)
}

/// Decode the stored columns of one access row.
#[expect(
    clippy::too_many_arguments,
    reason = "one argument per stored column of the access row"
)]
fn row(
    approved: bool,
    permission_revision: i64,
    request_id: Option<Uuid>,
    request_permission: Option<String>,
    request_status: Option<String>,
    request_revision: i64,
    request_updated_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<AgentAccessRow, Error> {
    let request = match (
        request_id,
        request_permission,
        request_status,
        request_updated_at,
    ) {
        (Some(id), Some(requested), Some(state), Some(updated_at)) => Some(StoredRequest {
            id,
            permission: permission(&requested)?,
            status: status(&state)?,
            revision: request_revision,
            updated_at,
        }),
        (None, None, None, None) => None,
        _ => return Err(Error::Unavailable),
    };
    Ok(AgentAccessRow {
        approved,
        permission_revision,
        request,
    })
}

async fn insert_audit(connection: &mut PgConnection, entries: &[AgentAudit]) -> Result<(), Error> {
    let teams: Vec<Uuid> = entries.iter().map(|entry| entry.team.0).collect();
    let items: Vec<Uuid> = entries.iter().map(|entry| entry.item.0).collect();
    let ids: Vec<Uuid> = entries.iter().map(|entry| entry.event_id).collect();
    let actors: Vec<String> = entries
        .iter()
        .map(|entry| entry.actor.to_string())
        .collect();
    let agents: Vec<String> = entries
        .iter()
        .map(|entry| entry.agent.to_string())
        .collect();
    let wakes: Vec<Option<Uuid>> = entries
        .iter()
        .map(|entry| entry.wake.map(|wake| wake.0))
        .collect();
    let revisions: Vec<Option<i64>> = entries
        .iter()
        .map(|entry| entry.permission_revision)
        .collect();
    let actions = entries
        .iter()
        .map(|entry| action_text(entry.action))
        .collect::<Result<Vec<_>, _>>()?;
    let trace = trace_id();
    sqlx::query!(
        r#"INSERT INTO password_activity(team_id,item_id,id,user_id,action,trace_id,agent_user_id,wake_id,permission_revision)
        SELECT entry.team_id,entry.item_id,entry.id,entry.user_id,entry.action,$9,entry.agent_user_id,entry.wake_id,entry.permission_revision
        FROM UNNEST($1::uuid[],$2::uuid[],$3::uuid[],$4::text[],$5::text[],$6::text[],$7::uuid[],$8::int8[])
            AS entry(team_id,item_id,id,user_id,agent_user_id,action,wake_id,permission_revision)
        ON CONFLICT(team_id,item_id,id) DO NOTHING"#,
        &teams,
        &items,
        &ids,
        &actors,
        &agents,
        &actions,
        &wakes as &[Option<Uuid>],
        &revisions as &[Option<i64>],
        trace
    )
    .execute(connection)
    .await
    .map_err(database_error)?;
    Ok(())
}

async fn locked_row(
    connection: &mut PgConnection,
    team: TeamId,
    item: ItemId,
    agent: &str,
) -> Result<Option<AgentAccessRow>, Error> {
    let stored = sqlx::query!(
        r#"SELECT approved_by IS NOT NULL AS "approved!",permission_revision,request_id,request_permission,request_status,request_revision,request_updated_at
        FROM password_agent_access WHERE team_id=$1 AND item_id=$2 AND agent_user_id=$3 FOR UPDATE"#,
        team.0,
        item.0,
        agent
    )
    .fetch_optional(connection)
    .await
    .map_err(database_error)?;
    stored
        .map(|stored| {
            row(
                stored.approved,
                stored.permission_revision,
                stored.request_id,
                stored.request_permission,
                stored.request_status,
                stored.request_revision,
                stored.request_updated_at,
            )
        })
        .transpose()
}

#[async_trait]
impl AgentRepository for PgRepository {
    #[tracing::instrument(skip_all,err,name="passwords.agent.intent.publish",fields(team_id=%record.metadata.team_id.0,item_id=%record.metadata.id.0,outcome=tracing::field::Empty))]
    async fn stage(
        &self,
        operation: Uuid,
        record: &Record,
        publisher: &IntentAgent,
    ) -> Result<(), Error> {
        let agent = &publisher.agent;
        let mut transaction = self.pool.begin().await.map_err(|_| Error::Unavailable)?;
        // Serialize with team closure exactly like human publication; the
        // publisher must be an agent account, so this never admits a human.
        let admitted = sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM team WHERE id=$1 FOR KEY SHARE)
                AND NOT EXISTS(SELECT 1 FROM password_team_lifecycle WHERE team_id=$1)
                AND EXISTS(SELECT 1 FROM "User" WHERE id=$2 AND "isAgent") AS "admitted!""#,
            record.metadata.team_id.0,
            agent.as_ref()
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| Error::Unavailable)?;
        if !admitted {
            tracing::Span::current().record("outcome", "admission_revoked");
            return Err(Error::NotFound);
        }
        // An update is published only while the agent still holds a usable Edit
        // grant: its Agent Edit grant and creator attribution or standing approval.
        // Its operation id must not already name an enrollment or any other audit
        // entry of the item, so its own audit can never be silently dropped; only
        // this agent's replay of the same update passes.
        if publisher.action == AgentAction::AgentUpdate {
            let edit_grant =
                serde_json::json!([{"kind":"agent","id":agent.as_ref(),"permission":"edit"}]);
            let fence = sqlx::query!(
                r#"SELECT EXISTS(SELECT 1 FROM password_item_entities item WHERE item.team_id=$1 AND item.id=$2 AND NOT item.deleting AND item.deleted_at IS NULL AND item.grants @> $3
                    AND (item.user_id=$4 OR EXISTS(SELECT 1 FROM password_agent_access access WHERE access.team_id=item.team_id AND access.item_id=item.id AND access.agent_user_id=$4 AND access.approved_by IS NOT NULL))
                    FOR KEY SHARE OF item) AS "authorized!",
                    NOT EXISTS(SELECT 1 FROM password_totp_enrollments WHERE team_id=$1 AND key_id=$5)
                    AND NOT EXISTS(SELECT 1 FROM password_activity WHERE team_id=$1 AND item_id=$2 AND id=$5 AND NOT (action='agent_update' AND user_id=$4)) AS "identity_free!""#,
                record.metadata.team_id.0,
                record.metadata.id.0,
                edit_grant,
                agent.as_ref(),
                operation
            )
            .fetch_one(&mut *transaction)
            .await
            .map_err(database_error)?;
            // Authority first, so an unauthorized caller learns nothing about
            // which operation ids are taken.
            if !fence.authorized {
                tracing::Span::current().record("outcome", "authority_revoked");
                return Err(Error::Forbidden);
            }
            if !fence.identity_free {
                tracing::Span::current().record("outcome", "operation_conflict");
                return Err(Error::Conflict);
            }
        }
        let action = action_text(publisher.action)?;
        publish_intent(
            &mut transaction,
            operation,
            record,
            Some(super::IntentPublisher {
                agent: agent.as_ref(),
                wake: publisher.wake.0,
                action: &action,
            }),
        )
        .await?;
        transaction.commit().await.map_err(|_| Error::Unavailable)?;
        tracing::Span::current().record("outcome", "published");
        Ok(())
    }

    async fn catalog(
        &self,
        team: TeamId,
        agent: &MacroUserIdStr<'_>,
        query: &str,
        after: Option<ItemId>,
        limit: u8,
    ) -> Result<Vec<Record>, Error> {
        let mut transaction = self.bounded_transaction().await?;
        let team_grant = serde_json::json!([{"kind":"team","id":team.0.to_string()}]);
        let agent_grant = serde_json::json!([{"kind":"agent","id":agent.as_ref()}]);
        let pattern = format!(
            "%{}%",
            query
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let rows=sqlx::query!(r#"SELECT metadata,user_id,grants,deleting,revision,totp_key_id FROM password_item_entities WHERE team_id=$1 AND deleted_at IS NULL AND NOT deleting AND (grants @> $3 OR grants @> $4 OR user_id=$5) AND ($6::uuid IS NULL OR id < $6) AND (lower(metadata->>'name') || ' ' || lower(COALESCE(metadata->>'url',''))) LIKE lower($2) ESCAPE '\' ORDER BY id DESC LIMIT $7"#,team.0,pattern,team_grant,agent_grant,agent.as_ref(),after.map(|item| item.0),i64::from(limit)).fetch_all(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        rows.into_iter()
            .map(|row| {
                decode(
                    row.metadata,
                    row.user_id,
                    row.grants,
                    row.deleting,
                    row.revision,
                    row.totp_key_id,
                )
            })
            .collect()
    }

    async fn access(
        &self,
        team: TeamId,
        items: &[ItemId],
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Vec<(ItemId, AgentAccessRow)>, Error> {
        let ids: Vec<Uuid> = items.iter().map(|item| item.0).collect();
        let rows = sqlx::query!(
            r#"SELECT item_id,approved_by IS NOT NULL AS "approved!",permission_revision,request_id,request_permission,request_status,request_revision,request_updated_at
            FROM password_agent_access WHERE team_id=$1 AND item_id=ANY($2) AND agent_user_id=$3"#,
            team.0,
            &ids,
            agent.as_ref()
        )
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)?;
        rows.into_iter()
            .map(|stored| {
                Ok((
                    ItemId(stored.item_id),
                    row(
                        stored.approved,
                        stored.permission_revision,
                        stored.request_id,
                        stored.request_permission,
                        stored.request_status,
                        stored.request_revision,
                        stored.request_updated_at,
                    )?,
                ))
            })
            .collect()
    }

    #[tracing::instrument(skip_all, err, name = "passwords.agent.audit", fields(entry_count = entries.len()))]
    async fn audit(&self, entries: &[AgentAudit]) -> Result<(), Error> {
        if entries.is_empty() {
            return Ok(());
        }
        let mut connection = self.pool.acquire().await.map_err(database_error)?;
        insert_audit(&mut connection, entries).await
    }

    #[tracing::instrument(skip_all, err, name = "passwords.agent.request.commit", fields(team_id = %request.team.0, item_id = %request.item.0, outcome = tracing::field::Empty))]
    async fn request(&self, request: NewRequest) -> Result<RequestOutcome, Error> {
        let mut transaction = self.bounded_transaction().await?;
        // Serialize one agent's requests in a team so the rate count is exact.
        let key = format!(
            "passwords/agent-requests/{}/{}",
            request.team.0, request.agent
        );
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", key)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        let existing = locked_row(
            &mut transaction,
            request.team,
            request.item,
            request.agent.as_ref(),
        )
        .await?;
        if let Some(existing) = &existing
            && let Some(stored) = &existing.request
        {
            if stored.status == StoredRequestStatus::Pending {
                tracing::Span::current().record("outcome", "deduplicated");
                return Ok(RequestOutcome::Deduplicated(existing.clone()));
            }
            let cooldown_end = stored.updated_at + request.limits.denied_cooldown;
            if stored.status == StoredRequestStatus::Denied && cooldown_end > chrono::Utc::now() {
                tracing::Span::current().record("outcome", "cooling_down");
                return Ok(RequestOutcome::RetryAt(cooldown_end));
            }
        }
        let window_start = chrono::Utc::now() - request.limits.window;
        let recent = sqlx::query!(
            r#"SELECT count(*) AS "count!",min(occurred_at) AS oldest FROM password_activity WHERE team_id=$1 AND agent_user_id=$2 AND action='agent_access_request' AND occurred_at>$3"#,
            request.team.0,
            request.agent.as_ref(),
            window_start
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        if recent.count >= request.limits.max_new_requests {
            tracing::Span::current().record("outcome", "rate_limited");
            let oldest = recent.oldest.ok_or(Error::Unavailable)?;
            return Ok(RequestOutcome::RetryAt(oldest + request.limits.window));
        }
        let stored = sqlx::query!(
            r#"INSERT INTO password_agent_access(team_id,item_id,agent_user_id,request_id,request_permission,request_status,request_revision,request_updated_at)
            VALUES($1,$2,$3,$4,$5,'pending',1,now())
            ON CONFLICT(team_id,item_id,agent_user_id) DO UPDATE SET request_id=excluded.request_id,request_permission=excluded.request_permission,request_status='pending',request_revision=password_agent_access.request_revision+1,request_updated_at=now()
            RETURNING approved_by IS NOT NULL AS "approved!",permission_revision,request_id,request_permission,request_status,request_revision,request_updated_at"#,
            request.team.0,
            request.item.0,
            request.agent.as_ref(),
            request.request_id,
            permission_text(request.permission)
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        let created = row(
            stored.approved,
            stored.permission_revision,
            stored.request_id,
            stored.request_permission,
            stored.request_status,
            stored.request_revision,
            stored.request_updated_at,
        )?;
        insert_audit(
            &mut transaction,
            &[AgentAudit {
                team: request.team,
                item: request.item,
                actor: request.agent.clone(),
                agent: request.agent.clone(),
                wake: Some(request.wake),
                action: AgentAction::AgentAccessRequest,
                permission_revision: Some(created.permission_revision),
                event_id: request.request_id,
            }],
        )
        .await?;
        // Reviewers are the current human creator, while still a member, and
        // the current human team administrators.
        let reviewers = sqlx::query_scalar!(
            r#"SELECT DISTINCT membership.user_id FROM team_user membership JOIN "User" profile ON profile.id=membership.user_id
            WHERE membership.team_id=$1 AND NOT profile."isAgent" AND (membership.team_role IN ('owner','admin') OR membership.user_id=$2)"#,
            request.team.0,
            request.human_creator.as_ref().map(|creator| creator.as_ref())
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        sqlx::query!(
            "INSERT INTO password_agent_access_events(id,team_id,item_id,agent_user_id,request_id,status,item_name,reviewers) VALUES($1,$2,$3,$4,$5,'pending',$6,$7)",
            Uuid::now_v7(),
            request.team.0,
            request.item.0,
            request.agent.as_ref(),
            request.request_id,
            request.item_name,
            serde_json::json!(reviewers)
        )
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        tracing::Span::current().record("outcome", "created");
        Ok(RequestOutcome::Created(created))
    }

    #[tracing::instrument(skip_all, err, name = "passwords.agent.access.transition", fields(team_id = %transition.record.metadata.team_id.0, item_id = %transition.record.metadata.id.0))]
    async fn transition(&self, transition: AccessTransition) -> Result<AgentAccessRow, Error> {
        let team = transition.record.metadata.team_id;
        let item = transition.record.metadata.id;
        let agent = transition.agent.as_ref();
        let mut transaction = self.bounded_transaction().await?;
        let current = sqlx::query!(
            "SELECT revision,deleting FROM password_item_entities WHERE team_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
            team.0,
            item.0
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or(Error::NotFound)?;
        if current.deleting {
            return Err(Error::NotFound);
        }
        if current.revision != transition.record.revision {
            return Err(Error::Conflict);
        }
        let existing = locked_row(&mut transaction, team, item, agent).await?;
        let matches = match transition.expected {
            Expected::Request { id, revision } => existing
                .as_ref()
                .and_then(|row| row.request.as_ref())
                .is_some_and(|request| {
                    request.id == id
                        && request.revision == revision
                        && request.status == StoredRequestStatus::Pending
                }),
            Expected::PermissionRevision(revision) => {
                existing.as_ref().map_or(0, |row| row.permission_revision) == revision
            }
        };
        if !matches {
            return Err(Error::Conflict);
        }
        if transition.permission_changed {
            let grants =
                serde_json::to_value(&transition.record.grants).map_err(|_| Error::Invalid)?;
            sqlx::query!(
                "UPDATE password_item_entities SET grants=$3,revision=revision+1 WHERE team_id=$1 AND id=$2",
                team.0,
                item.0,
                grants
            )
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        }
        let stored = sqlx::query!(
            r#"INSERT INTO password_agent_access(team_id,item_id,agent_user_id,approved_by,permission_revision)
            VALUES($1,$2,$3,CASE WHEN $4 THEN $5 END,CASE WHEN $6 THEN 1 ELSE 0 END)
            ON CONFLICT(team_id,item_id,agent_user_id) DO UPDATE SET
                approved_by=CASE WHEN $4 THEN COALESCE(password_agent_access.approved_by,$5) END,
                permission_revision=password_agent_access.permission_revision+CASE WHEN $6 THEN 1 ELSE 0 END,
                request_status=COALESCE($7,password_agent_access.request_status),
                request_revision=password_agent_access.request_revision+CASE WHEN $7::text IS NULL THEN 0 ELSE 1 END,
                request_updated_at=CASE WHEN $7::text IS NULL THEN password_agent_access.request_updated_at ELSE now() END
            RETURNING approved_by IS NOT NULL AS "approved!",permission_revision,request_id,request_permission,request_status,request_revision,request_updated_at"#,
            team.0,
            item.0,
            agent,
            transition.approved,
            transition.reviewer.as_ref(),
            transition.permission_changed,
            transition.request_status.map(status_text)
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        let updated = row(
            stored.approved,
            stored.permission_revision,
            stored.request_id,
            stored.request_permission,
            stored.request_status,
            stored.request_revision,
            stored.request_updated_at,
        )?;
        insert_audit(
            &mut transaction,
            &[AgentAudit {
                team,
                item,
                actor: transition.reviewer.clone(),
                agent: transition.agent.clone(),
                wake: None,
                action: transition.action,
                permission_revision: Some(updated.permission_revision),
                event_id: Uuid::now_v7(),
            }],
        )
        .await?;
        if let (Some(new_status), Some(request)) = (transition.request_status, &updated.request) {
            sqlx::query!(
                "INSERT INTO password_agent_access_events(id,team_id,item_id,agent_user_id,request_id,status,item_name) VALUES($1,$2,$3,$4,$5,$6,$7)",
                Uuid::now_v7(),
                team.0,
                item.0,
                agent,
                request.id,
                status_text(new_status),
                transition.record.metadata.name
            )
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        }
        transaction.commit().await.map_err(database_error)?;
        Ok(updated)
    }

    async fn pending(
        &self,
        team: TeamId,
        creator: Option<&MacroUserIdStr<'_>>,
        after: Option<Uuid>,
        limit: u8,
    ) -> Result<Vec<PendingRequest>, Error> {
        let mut transaction = self.bounded_transaction().await?;
        let rows = sqlx::query!(
            r#"SELECT access.agent_user_id,access.approved_by IS NOT NULL AS "approved!",access.permission_revision,access.request_id,access.request_permission,access.request_status,access.request_revision,access.request_updated_at,
                item.metadata,item.user_id,item.grants,item.deleting,item.revision,item.totp_key_id
            FROM password_agent_access access
            CROSS JOIN LATERAL (
                SELECT keyed_item.metadata,keyed_item.user_id,keyed_item.grants,keyed_item.deleting,keyed_item.revision,keyed_item.totp_key_id,keyed_item.deleted_at
                FROM password_item_entities keyed_item
                WHERE keyed_item.team_id=access.team_id AND keyed_item.id=access.item_id
                OFFSET 0
            ) item
            WHERE access.team_id=$1 AND access.request_status='pending' AND item.deleted_at IS NULL AND NOT item.deleting
                AND ($2::text IS NULL OR item.user_id=$2) AND ($3::uuid IS NULL OR access.request_id>$3)
            ORDER BY access.request_id LIMIT $4"#,
            team.0,
            creator.map(|creator| creator.as_ref()),
            after,
            i64::from(limit)
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        rows.into_iter()
            .map(|stored| {
                Ok(PendingRequest {
                    agent: user(stored.agent_user_id)?,
                    row: row(
                        stored.approved,
                        stored.permission_revision,
                        stored.request_id,
                        stored.request_permission,
                        stored.request_status,
                        stored.request_revision,
                        stored.request_updated_at,
                    )?,
                    record: decode(
                        stored.metadata,
                        stored.user_id,
                        stored.grants,
                        stored.deleting,
                        stored.revision,
                        stored.totp_key_id,
                    )?,
                })
            })
            .collect()
    }

    async fn find_request(
        &self,
        team: TeamId,
        item: ItemId,
        request: Uuid,
    ) -> Result<Option<(MacroUserIdStr<'static>, AgentAccessRow)>, Error> {
        let stored = sqlx::query!(
            r#"SELECT agent_user_id,approved_by IS NOT NULL AS "approved!",permission_revision,request_id,request_permission,request_status,request_revision,request_updated_at
            FROM password_agent_access WHERE team_id=$1 AND item_id=$2 AND request_id=$3"#,
            team.0,
            item.0,
            request
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?;
        stored
            .map(|stored| {
                Ok((
                    user(stored.agent_user_id)?,
                    row(
                        stored.approved,
                        stored.permission_revision,
                        stored.request_id,
                        stored.request_permission,
                        stored.request_status,
                        stored.request_revision,
                        stored.request_updated_at,
                    )?,
                ))
            })
            .transpose()
    }

    async fn undelivered(&self) -> Result<Vec<AccessEvent>, Error> {
        let rows = sqlx::query!(
            "SELECT id,team_id,item_id,agent_user_id,request_id,status,item_name,reviewers FROM password_agent_access_events WHERE delivered_at IS NULL AND retry_after<=now() ORDER BY retry_after,id LIMIT $1",
            UNDELIVERED_BATCH
        )
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)?;
        rows.into_iter()
            .map(|stored| {
                let reviewers: Vec<String> =
                    serde_json::from_value(stored.reviewers).map_err(|_| Error::Unavailable)?;
                Ok(AccessEvent {
                    id: stored.id,
                    team: TeamId(stored.team_id),
                    item: ItemId(stored.item_id),
                    item_name: stored.item_name,
                    agent: user(stored.agent_user_id)?,
                    request_id: stored.request_id,
                    status: status(&stored.status)?,
                    reviewers: reviewers.into_iter().map(user).collect::<Result<_, _>>()?,
                })
            })
            .collect()
    }

    async fn defer(&self, id: Uuid) -> Result<(), Error> {
        // 2^attempts seconds, capped at one hour.
        sqlx::query!(
            "UPDATE password_agent_access_events SET attempts=attempts+1,retry_after=now()+LEAST(interval '1 hour',interval '1 second'*power(2,LEAST(attempts,12))) WHERE id=$1 AND delivered_at IS NULL",
            id
        )
        .execute(&self.pool)
        .await
        .map_err(database_error)?;
        Ok(())
    }

    async fn stage_totp(
        &self,
        team: TeamId,
        item: ItemId,
        key: TotpKeyId,
        publisher: &IntentAgent,
    ) -> Result<(), Error> {
        // A new generation, or this same agent's own pending setup of this item
        // (whose original wake is kept). Any other existing key is a conflict, so
        // a stale caller can never proceed to overwrite another enrollment's seed.
        // A key already naming another audit entry of the item is refused too.
        let staged = sqlx::query!(r#"INSERT INTO password_totp_enrollments(team_id,item_id,key_id,state,cleanup_after,agent_user_id,wake_id) SELECT $1,$2,$3,'pending',now()+interval '180 seconds',$4,$5 WHERE NOT EXISTS(SELECT 1 FROM password_activity WHERE team_id=$1 AND item_id=$2 AND id=$3 AND NOT (action='agent_totp_setup' AND user_id=$4)) ON CONFLICT(team_id,key_id) DO UPDATE SET key_id=password_totp_enrollments.key_id WHERE password_totp_enrollments.item_id=excluded.item_id AND password_totp_enrollments.state='pending' AND password_totp_enrollments.agent_user_id=excluded.agent_user_id"#,team.0,item.0,key.0,publisher.agent.as_ref(),publisher.wake.0).execute(&self.pool).await.map_err(database_error)?;
        if staged.rows_affected() != 1 {
            return Err(Error::Conflict);
        }
        Ok(())
    }

    async fn enrollment(
        &self,
        team: TeamId,
        key: TotpKeyId,
    ) -> Result<Option<(ItemId, EnrollmentState)>, Error> {
        let stored = sqlx::query!(
            "SELECT item_id,state FROM password_totp_enrollments WHERE team_id=$1 AND key_id=$2",
            team.0,
            key.0
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?;
        stored
            .map(|stored| {
                let state = match stored.state.as_str() {
                    "pending" => EnrollmentState::Pending,
                    "active" => EnrollmentState::Active,
                    "retired" => EnrollmentState::Retired,
                    _ => return Err(Error::Unavailable),
                };
                Ok((ItemId(stored.item_id), state))
            })
            .transpose()
    }

    async fn item_access(
        &self,
        team: TeamId,
        item: ItemId,
        after: Option<&MacroUserIdStr<'_>>,
        limit: u8,
    ) -> Result<Vec<(MacroUserIdStr<'static>, AgentAccessRow)>, Error> {
        let rows = sqlx::query!(
            r#"SELECT agent_user_id,approved_by IS NOT NULL AS "approved!",permission_revision,request_id,request_permission,request_status,request_revision,request_updated_at
            FROM password_agent_access WHERE team_id=$1 AND item_id=$2 AND ($3::text IS NULL OR agent_user_id>$3) ORDER BY agent_user_id LIMIT $4"#,
            team.0,
            item.0,
            after.map(|agent| agent.as_ref()),
            i64::from(limit)
        )
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)?;
        rows.into_iter()
            .map(|stored| {
                Ok((
                    user(stored.agent_user_id)?,
                    row(
                        stored.approved,
                        stored.permission_revision,
                        stored.request_id,
                        stored.request_permission,
                        stored.request_status,
                        stored.request_revision,
                        stored.request_updated_at,
                    )?,
                ))
            })
            .collect()
    }

    async fn delivered(&self, id: Uuid) -> Result<(), Error> {
        sqlx::query!(
            "UPDATE password_agent_access_events SET delivered_at=COALESCE(delivered_at,now()) WHERE id=$1",
            id
        )
        .execute(&self.pool)
        .await
        .map_err(database_error)?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
