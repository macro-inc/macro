//! Durable funding adapter. Policy transitions live in the domain; this adapter
//! owns locking, immutable replay checks and atomic persistence of their results.

use ai_usage::domain::financial::*;
use ai_usage::domain::financial_service::validate_final_record;
use ai_usage::domain::ports::FinancialFuture;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool, types::Json};

use crate::domain::financial::*;
use crate::domain::models::{BillingPeriod, UsagePolicy};
use crate::domain::policy::*;
use crate::domain::ports::FundingRepo;

#[cfg(test)]
mod test;

/// Postgres funding persistence, constructed only at composition roots.
#[derive(Clone)]
pub struct PgFundingRepo {
    pool: PgPool,
}

impl PgFundingRepo {
    /// Share the same database/payer account lock as `PgBillingRepo`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Serialize purchases, settings, legacy settlement and funding on the account row.
/// Account upserts/updates inherently acquire this same row lock.
pub(super) async fn lock_payer(conn: &mut PgConnection, payer: &str) -> FinancialResult<()> {
    sqlx::query!(
        "INSERT INTO ai_billing_account (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
        payer,
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        "SELECT user_id FROM ai_billing_account WHERE user_id = $1 FOR UPDATE",
        payer
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

fn units(value: i64) -> FinancialResult<u64> {
    u64::try_from(value).map_err(|_| FinancialError::ArithmeticOverflow)
}

fn db_units(value: u64) -> FinancialResult<i64> {
    i64::try_from(value).map_err(|_| FinancialError::ArithmeticOverflow)
}

fn conflict(id: InvocationId, phase: ReplayPhase) -> FinancialError {
    FinancialError::ReplayConflict {
        invocation_id: id,
        phase,
    }
}

/// Read exact money unavailable to legacy settlement as well as new admission.
pub(super) async fn credit_commitments(
    conn: &mut PgConnection,
    payer: &str,
) -> FinancialResult<CreditCommitments> {
    let row = sqlx::query!(
        r#"SELECT
          COALESCE((SELECT prepaid_remainder FROM ai_funding_state WHERE user_id = $1), 0) AS "remainder!",
          COALESCE((SELECT SUM(prepaid_hold)::bigint FROM ai_funding_reservation WHERE payer_id = $1 AND NOT allocated), 0) AS "held!",
          COALESCE((SELECT SUM(units)::bigint FROM ai_funding_prepaid_release WHERE payer_id = $1), 0) AS "released!""#,
        payer,
    ).fetch_one(conn).await?;
    Ok(CreditCommitments {
        remainder: CustomerMoney::from_units(units(row.remainder)?),
        held: CustomerMoney::from_units(units(row.held)?),
        release_pool: CustomerMoney::from_units(units(row.released)?),
    })
}

/// New-policy cap commitments are protected from legacy settlement, including holds.
pub(super) async fn postpaid_commitments(
    conn: &mut PgConnection,
    payer: &str,
    start: DateTime<Utc>,
) -> FinancialResult<CustomerMoney> {
    let amount = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(CASE WHEN allocated THEN postpaid ELSE postpaid_hold END), 0)::bigint AS "amount!"
           FROM ai_funding_reservation WHERE payer_id = $1 AND period_start = $2"#,
        payer, start,
    ).fetch_one(conn).await?;
    Ok(CustomerMoney::from_units(units(amount)?))
}

async fn read_period(
    conn: &mut PgConnection,
    seat: &str,
    at: DateTime<Utc>,
) -> FinancialResult<Option<FundingPeriod>> {
    let row = sqlx::query!(
        "SELECT user_id, payer_id, subscription_id, period_start, period_end, policy FROM ai_billing_usage_period
         WHERE user_id = $1 AND period_start <= $2 AND period_end > $2",
        seat, at,
    ).fetch_optional(conn).await?;
    row.map(|r| {
        Ok(FundingPeriod {
            seat: MacroUserIdStr::try_from(r.user_id)
                .map_err(|_| FinancialError::InvalidIdentifier)?,
            payer: MacroUserIdStr::try_from(r.payer_id)
                .map_err(|_| FinancialError::InvalidIdentifier)?,
            subscription: FundingSubscription::new(r.subscription_id)?,
            period: BillingPeriod {
                start: r.period_start,
                end: r.period_end,
            },
            policy: match r.policy.as_str() {
                "legacy" => UsagePolicy::Legacy,
                "public_allowance_v1" => UsagePolicy::PublicAllowanceV1,
                _ => return Err(FinancialError::FundingDenied),
            },
        })
    })
    .transpose()
}

impl FundingRepo for PgFundingRepo {
    fn period(
        &self,
        seat: MacroUserIdStr<'static>,
        at: DateTime<Utc>,
    ) -> FinancialFuture<'_, Option<FundingPeriod>> {
        Box::pin(
            async move { read_period(&mut *self.pool.acquire().await?, seat.as_ref(), at).await },
        )
    }

    fn record_period(&self, period: FundingPeriod) -> FinancialFuture<'_, ()> {
        Box::pin(async move {
            period.validate()?;
            let mut tx = self.pool.begin().await?;
            // Serialize seat bindings across payer changes, then acquire the payer lock.
            // This lock is not used by admission, which never mutates period bindings.
            sqlx::query!(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 7404))",
                period.seat.as_ref()
            )
            .execute(&mut *tx)
            .await?;
            lock_payer(&mut tx, period.payer.as_ref()).await?;
            let overlap = sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM ai_billing_usage_period
                   WHERE user_id = $1 AND period_start < $3 AND period_end > $2) AS "exists!""#,
                period.seat.as_ref(),
                period.period.start,
                period.period.end,
            )
            .fetch_one(&mut *tx)
            .await?;
            if overlap {
                if read_period(&mut tx, period.seat.as_ref(), period.period.start)
                    .await?
                    .as_ref()
                    != Some(&period)
                {
                    return Err(FinancialError::FundingDenied);
                }
                return Ok(());
            }
            let policy = match period.policy {
                UsagePolicy::Legacy => "legacy",
                UsagePolicy::PublicAllowanceV1 => "public_allowance_v1",
            };
            sqlx::query!(
                "INSERT INTO ai_billing_usage_period (user_id, payer_id, subscription_id, period_start, period_end, policy)
                 VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
                period.seat.as_ref(), period.payer.as_ref(), period.subscription.as_str(),
                period.period.start, period.period.end, policy,
            ).execute(&mut *tx).await?;
            tx.commit().await?;
            Ok(())
        })
    }

    fn authorize(
        &self,
        request: BeginInvocation,
        rate: RateSnapshot,
    ) -> FinancialFuture<'_, FundingAuthorization> {
        Box::pin(async move {
            rate.require_model(&request.model)?;
            let identity = admission_identity(&request, &rate);
            let mut tx = self.pool.begin().await?;
            // Lock a global invocation identity before resolving/locking its payer.
            // This also serializes conflicting identities attributed to different payers.
            sqlx::query!(
                "INSERT INTO ai_funding_intent (invocation_id, identity) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                request.invocation_id.as_uuid(), identity,
            ).execute(&mut *tx).await?;
            let intent = sqlx::query!(
                "SELECT identity, denied FROM ai_funding_intent WHERE invocation_id = $1 FOR UPDATE",
                request.invocation_id.as_uuid(),
            ).fetch_one(&mut *tx).await?;
            if intent.identity != identity {
                return Err(conflict(request.invocation_id, ReplayPhase::Begin));
            }
            if intent.denied {
                return Err(FinancialError::FundingDenied);
            }
            let period = read_period(&mut tx, request.user.as_ref(), request.occurred_at).await?;
            let Some(period) =
                period.filter(|period| period.policy == UsagePolicy::PublicAllowanceV1)
            else {
                return reject(tx, request.invocation_id, FinancialError::FundingDenied).await;
            };
            lock_payer(&mut tx, period.payer.as_ref()).await?;
            if let Some(row) = sqlx::query!(
                r#"SELECT admission AS "admission: Json<AdmissionData>" FROM ai_funding_reservation WHERE invocation_id = $1"#,
                request.invocation_id.as_uuid(),
            ).fetch_optional(&mut *tx).await? {
                if row.admission.identity != identity {
                    return Err(conflict(request.invocation_id, ReplayPhase::Begin));
                }
                return row.admission.authorization();
            }
            sqlx::query!(
                "INSERT INTO ai_funding_state (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
                period.payer.as_ref()
            )
            .execute(&mut *tx)
            .await?;
            let account = sqlx::query!(
                "SELECT a.overage_enabled, a.overage_limit_cents, a.overage_suspended_at, a.authorization_revision,
                        f.next_sequence FROM ai_billing_account a JOIN ai_funding_state f USING (user_id) WHERE a.user_id = $1",
                period.payer.as_ref(),
            ).fetch_one(&mut *tx).await?;
            let settings = crate::domain::BillingSettings {
                overage_enabled: account.overage_enabled,
                overage_limit_cents: account.overage_limit_cents,
                overage_suspended_at: account.overage_suspended_at,
                ..Default::default()
            };
            let snapshot = AuthorizationSnapshot {
                id: FundingAuthorizationId::new(),
                invocation_id: request.invocation_id,
                payer: period.payer.clone(),
                seat: period.seat.clone(),
                period: period.period,
                policy: period.policy,
                settings_revision: AuthorizationRevision::from_raw(units(
                    account.authorization_revision,
                )?),
                postpaid: PostpaidAuthorization::from_settings(&settings).map_err(funding_error)?,
            };
            let available = availability(&mut tx, &period).await?;
            let maximum = rate.tokens.price(request.token_budget)?;
            let reservation = match reserve(
                snapshot,
                AllocationSequence::from_raw(units(account.next_sequence)?),
                maximum,
                available,
            ) {
                Ok(reservation) => reservation,
                Err(error) => return reject(tx, request.invocation_id, funding_error(error)).await,
            };
            let data = AdmissionData::new(identity, &reservation, available, &settings);
            let funding = data.authorization()?;
            let holds = reservation.holds();
            // Validate the persistence range before acknowledging any execution.
            db_units(maximum.units())?;
            sqlx::query!(
                "INSERT INTO ai_funding_reservation (invocation_id, authorization_id, payer_id, sequence, user_id, period_start,
                 admission, included_hold, prepaid_hold, postpaid_hold) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING",
                funding.invocation_id.as_uuid(), funding.id.as_uuid(), period.payer.as_ref(), account.next_sequence,
                period.seat.as_ref(), period.period.start, Json(data) as _,
                db_units(holds.included_public.units())?, db_units(holds.prepaid.units())?, db_units(holds.postpaid.units())?,
            ).execute(&mut *tx).await?;
            // A conflicting ID under another payer must not receive a new authorization.
            let stored = sqlx::query!(
                r#"SELECT admission AS "admission: Json<AdmissionData>" FROM ai_funding_reservation WHERE invocation_id = $1"#,
                request.invocation_id.as_uuid(),
            ).fetch_one(&mut *tx).await?;
            if stored.admission.authorization()? != funding {
                return Err(conflict(request.invocation_id, ReplayPhase::Begin));
            }
            sqlx::query!(
                "UPDATE ai_funding_state SET next_sequence = next_sequence + 1 WHERE user_id = $1",
                period.payer.as_ref()
            )
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            Ok(funding)
        })
    }

    fn finalize(&self, record: InvocationRecord) -> FinancialFuture<'_, ()> {
        Box::pin(async move {
            validate_final_record(&record)?;
            let id = record.admission.request.invocation_id;
            let identity = admission_identity(&record.admission.request, &record.admission.rate);
            let completion = completion_identity(&record.state)?;
            let actual = match record.state {
                InvocationState::Priced { public_usage, .. } => {
                    Some(db_units(public_usage.units())?)
                }
                InvocationState::Unpriced { .. } | InvocationState::Unresolved { .. } => None,
                _ => return Err(FinancialError::FundingDenied),
            };
            let mut tx = self.pool.begin().await?;
            let row = sqlx::query!(
                r#"SELECT payer_id, admission AS "admission: Json<AdmissionData>" FROM ai_funding_reservation WHERE invocation_id = $1"#,
                id.as_uuid(),
            ).fetch_optional(&mut *tx).await?.ok_or(FinancialError::InvocationNotFound)?;
            if row.admission.identity != identity
                || row.admission.authorization()? != record.admission.funding
            {
                return Err(conflict(id, ReplayPhase::Finalize));
            }
            lock_payer(&mut tx, &row.payer_id).await?;
            let previous = sqlx::query!(
                "SELECT completion FROM ai_funding_reservation WHERE invocation_id = $1",
                id.as_uuid()
            )
            .fetch_one(&mut *tx)
            .await?
            .completion;
            if let Some(previous) = previous {
                if previous != completion {
                    return Err(conflict(id, ReplayPhase::Finalize));
                }
            } else {
                sqlx::query!("UPDATE ai_funding_reservation SET completion = $2, actual_public = $3 WHERE invocation_id = $1",
                    id.as_uuid(), completion, actual).execute(&mut *tx).await?;
            }
            reconcile_locked(&mut tx, &row.payer_id).await?;
            tx.commit().await?;
            Ok(())
        })
    }

    fn allocation(&self, id: InvocationId) -> FinancialFuture<'_, Option<UsageAllocation>> {
        Box::pin(async move {
            let row = sqlx::query!(
                "SELECT included_public, extra_public, prepaid, reclaimed_prepaid, postpaid, macro_absorbed
                 FROM ai_funding_reservation WHERE invocation_id = $1 AND allocated", id.as_uuid(),
            ).fetch_optional(&self.pool).await?;
            row.map(|r| {
                Ok(UsageAllocation {
                    included_public: PublicUsage::from_units(units(r.included_public)?),
                    extra_public: PublicUsage::from_units(units(r.extra_public)?),
                    prepaid: CustomerMoney::from_units(units(r.prepaid)?),
                    reclaimed_prepaid: CustomerMoney::from_units(units(r.reclaimed_prepaid)?),
                    postpaid: CustomerMoney::from_units(units(r.postpaid)?),
                    macro_absorbed: CustomerMoney::from_units(units(r.macro_absorbed)?),
                })
            })
            .transpose()
        })
    }

    fn pending(&self, query: PendingInvocations) -> FinancialFuture<'_, Vec<InvocationId>> {
        Box::pin(async move {
            let rows = sqlx::query!(
                "SELECT invocation_id FROM ai_funding_reservation WHERE NOT allocated AND created_at < $1
                 AND ($2::uuid IS NULL OR invocation_id > $2) ORDER BY invocation_id LIMIT $3",
                query.before, query.after.map(InvocationId::as_uuid), i64::from(query.limit.get()),
            ).fetch_all(&self.pool).await?;
            rows.into_iter()
                .map(|r| r.invocation_id.try_into())
                .collect()
        })
    }

    fn reconcile(&self, payer: MacroUserIdStr<'static>) -> FinancialFuture<'_, ()> {
        Box::pin(async move {
            let mut tx = self.pool.begin().await?;
            lock_payer(&mut tx, payer.as_ref()).await?;
            reconcile_locked(&mut tx, payer.as_ref()).await?;
            tx.commit().await?;
            Ok(())
        })
    }
}

async fn reject(
    mut tx: sqlx::Transaction<'_, sqlx::Postgres>,
    id: InvocationId,
    error: FinancialError,
) -> FinancialResult<FundingAuthorization> {
    sqlx::query!(
        "UPDATE ai_funding_intent SET denied = TRUE WHERE invocation_id = $1",
        id.as_uuid()
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Err(error)
}

async fn availability(
    conn: &mut PgConnection,
    period: &FundingPeriod,
) -> FinancialResult<FundingAvailability> {
    let payer = period.payer.as_ref();
    let row = sqlx::query!(
        r#"SELECT
          COALESCE(SUM(actual_public) FILTER (WHERE allocated AND user_id = $2), 0)::bigint AS "used!",
          COALESCE(SUM(included_hold) FILTER (WHERE NOT allocated AND user_id = $2), 0)::bigint AS "included_held!",
          COALESCE(SUM(postpaid) FILTER (WHERE allocated), 0)::bigint AS "postpaid!",
          COALESCE(SUM(postpaid_hold) FILTER (WHERE NOT allocated), 0)::bigint AS "postpaid_held!"
          FROM ai_funding_reservation WHERE payer_id = $1 AND period_start = $3"#,
        payer, period.seat.as_ref(), period.period.start,
    ).fetch_one(&mut *conn).await?;
    let ledger = sqlx::query!(
        r#"SELECT
          COALESCE((SELECT SUM(delta_cents)::bigint FROM ai_credit_ledger WHERE user_id = $1), 0) AS "balance!",
          COALESCE((SELECT SUM(amount_cents)::bigint FROM ai_overage_charge WHERE user_id = $1 AND period_start = $2
            AND accounting_policy = 'legacy' AND (status <> 'failed' OR stripe_invoice_id IS NOT NULL)), 0) AS "charged!""#,
        payer, period.period.start,
    ).fetch_one(&mut *conn).await?;
    let credits = credit_commitments(conn, payer).await?;
    funding_availability(
        FundingAvailability {
            seat_public_used: PublicUsage::from_units(units(row.used)?),
            seat_public_held: PublicUsage::from_units(units(row.included_held)?),
            prepaid_available: CustomerMoney::from_units(0),
            prepaid_held: credits.held,
            postpaid_incurred: CustomerMoney::from_units(units(row.postpaid)?),
            postpaid_held: CustomerMoney::from_units(units(row.postpaid_held)?),
        },
        ledger.balance,
        credits,
        ledger.charged,
    )
}

/// Bounded work makes a large ready backlog restart-safe without unbounded transactions.
/// Unresolved evidence stops the watermark and retains every later hold.
async fn reconcile_locked(conn: &mut PgConnection, payer: &str) -> FinancialResult<()> {
    for _ in 0..100 {
        let row = sqlx::query!(
            r#"SELECT r.invocation_id, r.sequence, r.user_id, r.period_start, r.actual_public,
                      r.admission AS "admission: Json<AdmissionData>", f.next_sequence, f.prepaid_remainder
               FROM ai_funding_state f JOIN ai_funding_reservation r ON r.payer_id = f.user_id AND r.sequence = f.watermark
               WHERE f.user_id = $1 AND NOT r.allocated"#, payer,
        ).fetch_optional(&mut *conn).await?;
        let Some(row) = row else { break };
        let Some(actual) = row.actual_public else {
            break;
        };
        let used = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(actual_public), 0)::bigint AS "used!" FROM ai_funding_reservation
               WHERE payer_id = $1 AND user_id = $2 AND period_start = $3 AND allocated"#,
            payer,
            row.user_id,
            row.period_start,
        )
        .fetch_one(&mut *conn)
        .await?;
        let releases = sqlx::query!(
            "SELECT sequence, units FROM ai_funding_prepaid_release WHERE payer_id = $1 AND through_sequence >= $2 ORDER BY sequence",
            payer, row.sequence,
        ).fetch_all(&mut *conn).await?;
        let released = releases
            .iter()
            .try_fold(CustomerMoney::from_units(0), |total, r| {
                total.checked_add(CustomerMoney::from_units(units(r.units)?))
            })?;
        let mut reservation = row.admission.reservation()?;
        let allocation = reservation
            .allocate(
                AllocationPosition {
                    next_sequence: AllocationSequence::from_raw(units(row.sequence)?),
                    seat_public_used: PublicUsage::from_units(units(used)?),
                    prepaid_released_before: released,
                },
                PublicUsage::from_units(units(actual)?),
            )
            .map_err(funding_error)?;
        let (debit, remainder) = prepaid_debit(
            CustomerMoney::from_units(units(row.prepaid_remainder)?),
            allocation.prepaid,
        )?;
        if debit > 0 {
            sqlx::query!(
                "INSERT INTO ai_credit_ledger (id, user_id, kind, delta_cents, period_start, funding_invocation_id, note)
                 VALUES ($1, $2, 'consumption', $3, $4, $5, 'Authorized public-rate AI usage') ON CONFLICT (funding_invocation_id) DO NOTHING",
                macro_uuid::generate_uuid_v7(), payer, -debit, row.period_start, row.invocation_id,
            ).execute(&mut *conn).await?;
        }
        let mut reclaim = db_units(allocation.reclaimed_prepaid.units())?;
        for release in releases {
            let take = reclaim.min(release.units);
            if take == release.units {
                sqlx::query!(
                    "DELETE FROM ai_funding_prepaid_release WHERE payer_id = $1 AND sequence = $2",
                    payer,
                    release.sequence
                )
                .execute(&mut *conn)
                .await?;
            } else if take > 0 {
                sqlx::query!("UPDATE ai_funding_prepaid_release SET units = units - $3 WHERE payer_id = $1 AND sequence = $2", payer, release.sequence, take)
                    .execute(&mut *conn).await?;
            }
            reclaim -= take;
        }
        let released = reservation.released_holds().map_err(funding_error)?.prepaid;
        if released.units() > 0 && row.next_sequence > row.sequence + 1 {
            sqlx::query!(
                "INSERT INTO ai_funding_prepaid_release (payer_id, sequence, through_sequence, units) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
                payer, row.sequence, row.next_sequence - 1, db_units(released.units())?,
            ).execute(&mut *conn).await?;
        }
        sqlx::query!(
            "UPDATE ai_funding_reservation SET allocated = TRUE, included_public = $2, extra_public = $3,
             prepaid = $4, reclaimed_prepaid = $5, postpaid = $6, macro_absorbed = $7 WHERE invocation_id = $1",
            row.invocation_id, db_units(allocation.included_public.units())?, db_units(allocation.extra_public.units())?,
            db_units(allocation.prepaid.units())?, db_units(allocation.reclaimed_prepaid.units())?,
            db_units(allocation.postpaid.units())?, db_units(allocation.macro_absorbed.units())?,
        ).execute(&mut *conn).await?;
        sqlx::query!("UPDATE ai_funding_state SET watermark = watermark + 1, prepaid_remainder = $2 WHERE user_id = $1", payer, db_units(remainder.units())?)
            .execute(&mut *conn).await?;
        sqlx::query!(
            "DELETE FROM ai_funding_prepaid_release WHERE payer_id = $1 AND through_sequence <= $2",
            payer,
            row.sequence
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AdmissionData {
    identity: Value,
    id: Uuid,
    invocation_id: Uuid,
    payer: String,
    seat: String,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    revision: u64,
    policy: UsagePolicy,
    overage_enabled: bool,
    overage_limit_cents: i64,
    overage_suspended_at: Option<DateTime<Utc>>,
    postpaid: PostpaidData,
    sequence: u64,
    maximum: u64,
    available: [u64; 6],
}

#[derive(Debug, Serialize, Deserialize)]
enum PostpaidData {
    Disabled,
    Suspended,
    Enabled(u64),
}

impl AdmissionData {
    fn new(
        identity: Value,
        reservation: &Reservation,
        available: FundingAvailability,
        settings: &crate::domain::BillingSettings,
    ) -> Self {
        let auth = reservation.authorization();
        Self {
            identity,
            id: auth.id.as_uuid(),
            invocation_id: auth.invocation_id.as_uuid(),
            payer: auth.payer.as_ref().to_owned(),
            seat: auth.seat.as_ref().to_owned(),
            start: auth.period.start,
            end: auth.period.end,
            revision: auth.settings_revision.raw(),
            policy: auth.policy,
            overage_enabled: settings.overage_enabled,
            overage_limit_cents: settings.overage_limit_cents,
            overage_suspended_at: settings.overage_suspended_at,
            postpaid: match auth.postpaid {
                PostpaidAuthorization::Disabled => PostpaidData::Disabled,
                PostpaidAuthorization::Suspended => PostpaidData::Suspended,
                PostpaidAuthorization::Enabled { limit } => PostpaidData::Enabled(limit.units()),
            },
            sequence: reservation.sequence().raw(),
            maximum: reservation.maximum_public_usage().units(),
            available: [
                available.seat_public_used.units(),
                available.seat_public_held.units(),
                available.prepaid_available.units(),
                available.prepaid_held.units(),
                available.postpaid_incurred.units(),
                available.postpaid_held.units(),
            ],
        }
    }

    fn authorization(&self) -> FinancialResult<FundingAuthorization> {
        Ok(FundingAuthorization {
            id: self.id.try_into()?,
            invocation_id: self.invocation_id.try_into()?,
            maximum_public_usage: PublicUsage::from_units(self.maximum),
        })
    }

    fn reservation(&self) -> FinancialResult<Reservation> {
        let [used, held, prepaid, prepaid_held, incurred, postpaid_held] = self.available;
        reserve(
            AuthorizationSnapshot {
                id: self.id.try_into()?,
                invocation_id: self.invocation_id.try_into()?,
                payer: MacroUserIdStr::try_from(self.payer.clone())
                    .map_err(|_| FinancialError::InvalidIdentifier)?,
                seat: MacroUserIdStr::try_from(self.seat.clone())
                    .map_err(|_| FinancialError::InvalidIdentifier)?,
                period: BillingPeriod {
                    start: self.start,
                    end: self.end,
                },
                policy: self.policy,
                settings_revision: AuthorizationRevision::from_raw(self.revision),
                postpaid: match self.postpaid {
                    PostpaidData::Disabled => PostpaidAuthorization::Disabled,
                    PostpaidData::Suspended => PostpaidAuthorization::Suspended,
                    PostpaidData::Enabled(limit) => PostpaidAuthorization::Enabled {
                        limit: CustomerMoney::from_units(limit),
                    },
                },
            },
            AllocationSequence::from_raw(self.sequence),
            PublicUsage::from_units(self.maximum),
            FundingAvailability {
                seat_public_used: PublicUsage::from_units(used),
                seat_public_held: PublicUsage::from_units(held),
                prepaid_available: CustomerMoney::from_units(prepaid),
                prepaid_held: CustomerMoney::from_units(prepaid_held),
                postpaid_incurred: CustomerMoney::from_units(incurred),
                postpaid_held: CustomerMoney::from_units(postpaid_held),
            },
        )
        .map_err(funding_error)
    }
}

fn tokens(value: TrustedTokenUsage) -> [u64; 5] {
    [
        value.input(),
        value.output(),
        value.cache_read(),
        value.cache_write(),
        value.reasoning(),
    ]
}

// Minimal immutable handoff identities, not prompts, outputs or provider credentials.
// Evidence remains owned by ai_usage; no cross-domain SQL or mutable analytics joins.
fn admission_identity(request: &BeginInvocation, rate: &RateSnapshot) -> Value {
    json!({
        "run": request.run_id.as_uuid(), "invocation": request.invocation_id.as_uuid(),
        "user": request.user.as_ref(), "feature": request.feature, "entity": request.entity,
        "provider": request.model.provider(), "model": request.model.model(),
        "occurred_at": request.occurred_at, "budget": tokens(request.token_budget),
        "rate": rate.version.as_uuid(), "rate_effective_at": rate.effective_at,
        "rates": [rate.tokens.input, rate.tokens.output, rate.tokens.cache_read, rate.tokens.cache_write, rate.tokens.reasoning],
    })
}

fn completion_identity(state: &InvocationState) -> FinancialResult<Value> {
    let (evidence, status, amount) = match state {
        InvocationState::Priced {
            evidence,
            public_usage,
        } => (evidence, "priced", Some(public_usage.units())),
        InvocationState::Unresolved { evidence } => (evidence, "unresolved", None),
        InvocationState::Unpriced { evidence, .. } => (evidence, "unpriced", None),
        _ => return Err(FinancialError::FundingDenied),
    };
    let usage = match evidence.usage {
        UsageEvidence::Reported(value) => json!({"reported": tokens(value)}),
        UsageEvidence::Missing(reason) => json!({"missing": match reason {
            UnresolvedReason::UsageNotReported => "not_reported",
            UnresolvedReason::Interrupted => "interrupted",
            UnresolvedReason::UnsupportedDimensions => "unsupported_dimensions",
        }}),
    };
    let outcome = match evidence.outcome {
        ProviderOutcome::Succeeded => "succeeded",
        ProviderOutcome::Failed => "failed",
        ProviderOutcome::Cancelled => "cancelled",
        ProviderOutcome::Unknown => "unknown",
    };
    Ok(
        json!({"invocation": evidence.invocation_id.as_uuid(), "occurred_at": evidence.occurred_at,
        "request": evidence.provider_request_id.as_ref().map(ProviderRequestId::as_str),
        "outcome": outcome, "usage": usage, "status": status, "public_usage": amount}),
    )
}
