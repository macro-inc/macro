//! Append-only Postgres financial evidence, separate from the mutable analytics adapter.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, types::Json};

use crate::domain::financial::*;
use crate::domain::financial_service::*;
use crate::domain::ports::{FinancialFuture, FinancialRateResolver};

#[cfg(test)]
mod test;

/// Postgres implementation of the owning-domain journal and immutable rate ports.
#[derive(Clone)]
pub struct PgFinancialUsageRepo {
    pool: PgPool,
}

impl PgFinancialUsageRepo {
    /// Construct at a composition root; this adapter never constructs funding adapters.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl FinancialRateCatalog for PgFinancialUsageRepo {
    fn publish(&self, publication: RatePublication) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async move {
            publication.validate()?;
            let data = Json(RateData::from(&publication));
            let snapshot = &publication.snapshot;
            let inserted = sqlx::query!(
                r#"INSERT INTO ai_financial_rate
                   (version, provider, model, effective_at, valid_until, publication)
                   VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING"#,
                snapshot.version.as_uuid(),
                snapshot.model.provider(),
                snapshot.model.model(),
                snapshot.effective_at,
                publication.valid_until,
                data as _,
            )
            .execute(&self.pool)
            .await?
            .rows_affected()
                == 1;
            if inserted {
                return Ok(WriteDisposition::Inserted);
            }
            if self.publication(snapshot.version).await?.as_ref() != Some(&publication) {
                return Err(FinancialError::Infrastructure(rootcause::report!(
                    "conflicting immutable financial rate publication"
                )));
            }
            Ok(WriteDisposition::Replayed)
        })
    }

    fn publication(&self, version: RateVersion) -> FinancialFuture<'_, Option<RatePublication>> {
        Box::pin(async move {
            let row = sqlx::query!(
                r#"SELECT publication AS "publication: Json<RateData>"
                   FROM ai_financial_rate WHERE version = $1"#,
                version.as_uuid(),
            )
            .fetch_optional(&self.pool)
            .await?;
            row.map(|row| row.publication.0.decode()).transpose()
        })
    }
}

impl FinancialRateResolver for PgFinancialUsageRepo {
    fn resolve(
        &self,
        model: ProviderModel,
        occurred_at: DateTime<Utc>,
    ) -> FinancialFuture<'_, RateSnapshot> {
        Box::pin(async move {
            // Select the latest effective version FIRST, then test expiry. An expired
            // replacement must never revive an older, possibly cheaper rate.
            let row = sqlx::query!(
                r#"SELECT publication AS "publication: Json<RateData>"
                   FROM ai_financial_rate
                   WHERE provider = $1 AND model = $2 AND effective_at <= $3
                   ORDER BY effective_at DESC LIMIT 1"#,
                model.provider(),
                model.model(),
                occurred_at,
            )
            .fetch_optional(&self.pool)
            .await?
            .ok_or(FinancialError::RateUnavailable)?;
            let publication = row.publication.0.decode()?;
            if occurred_at >= publication.valid_until {
                return Err(FinancialError::RateUnavailable);
            }
            Ok(publication.snapshot)
        })
    }
}

impl FinancialUsageRepo for PgFinancialUsageRepo {
    fn prepare(
        &self,
        request: BeginInvocation,
        rate: RateSnapshot,
    ) -> FinancialFuture<'_, PreparedInvocation> {
        Box::pin(async move {
            rate.require_model(&request.model)?;
            let publication = self
                .publication(rate.version)
                .await?
                .ok_or(FinancialError::RateUnavailable)?;
            if publication.snapshot != rate
                || request.occurred_at < rate.effective_at
                || request.occurred_at >= publication.valid_until
            {
                return Err(FinancialError::RateUnavailable);
            }
            let data = Json(RequestData::from(&request));
            sqlx::query!(
                r#"INSERT INTO ai_financial_invocation (invocation_id, rate_version, occurred_at, request)
                   VALUES ($1, $2, $3, $4) ON CONFLICT (invocation_id) DO NOTHING"#,
                request.invocation_id.as_uuid(), rate.version.as_uuid(), request.occurred_at, data as _,
            ).execute(&self.pool).await?;
            let prepared = self
                .prepared(request.invocation_id)
                .await?
                .ok_or(FinancialError::InvocationNotFound)?;
            prepared.request.check_replay(&request)?;
            Ok(prepared)
        })
    }

    fn prepared(&self, id: InvocationId) -> FinancialFuture<'_, Option<PreparedInvocation>> {
        Box::pin(async move {
            let row = sqlx::query_as!(
                JournalRow,
                r#"SELECT j.request AS "request: Json<RequestData>",
                          r.publication AS "publication: Json<RateData>",
                          j.funding AS "funding: Json<FundingData>",
                          j.finalization AS "finalization: Json<StateData>"
                   FROM ai_financial_invocation j JOIN ai_financial_rate r ON r.version = j.rate_version
                   WHERE j.invocation_id = $1"#,
                id.as_uuid(),
            ).fetch_optional(&self.pool).await?;
            row.map(JournalRow::prepared).transpose()
        })
    }

    fn admit(
        &self,
        admission: AuthorizedInvocation,
    ) -> FinancialFuture<'_, Recorded<AuthorizedInvocation>> {
        Box::pin(async move {
            if admission.funding.invocation_id != admission.request.invocation_id
                || admission.funding.maximum_public_usage
                    < admission
                        .rate
                        .tokens
                        .price(admission.request.token_budget)?
            {
                return Err(FinancialError::FundingDenied);
            }
            let mut tx = self.pool.begin().await?;
            let row = sqlx::query_as!(
                JournalRow,
                r#"SELECT j.request AS "request: Json<RequestData>",
                          r.publication AS "publication: Json<RateData>",
                          j.funding AS "funding: Json<FundingData>",
                          j.finalization AS "finalization: Json<StateData>"
                   FROM ai_financial_invocation j JOIN ai_financial_rate r ON r.version = j.rate_version
                   WHERE j.invocation_id = $1 FOR UPDATE OF j"#,
                admission.request.invocation_id.as_uuid(),
            ).fetch_optional(&mut *tx).await?.ok_or(FinancialError::InvocationNotFound)?;
            let prepared = row.prepared()?;
            prepared.request.check_replay(&admission.request)?;
            if prepared.rate != admission.rate
                || prepared
                    .funding
                    .as_ref()
                    .is_some_and(|funding| funding != &admission.funding)
            {
                return Err(conflict(
                    admission.request.invocation_id,
                    ReplayPhase::Begin,
                ));
            }
            let disposition = if prepared.funding.is_some() {
                WriteDisposition::Replayed
            } else {
                let data = Json(FundingData::from(&admission.funding));
                sqlx::query!(
                    "UPDATE ai_financial_invocation SET funding = $2 WHERE invocation_id = $1",
                    admission.request.invocation_id.as_uuid(),
                    data as _,
                )
                .execute(&mut *tx)
                .await?;
                WriteDisposition::Inserted
            };
            tx.commit().await?;
            Ok(Recorded {
                value: admission,
                disposition,
            })
        })
    }

    fn finish(&self, record: InvocationRecord) -> FinancialFuture<'_, Recorded<InvocationRecord>> {
        Box::pin(async move {
            validate_final_record(&record)?;
            let id = record.admission.request.invocation_id;
            let mut tx = self.pool.begin().await?;
            let row = sqlx::query_as!(
                JournalRow,
                r#"SELECT j.request AS "request: Json<RequestData>",
                          r.publication AS "publication: Json<RateData>",
                          j.funding AS "funding: Json<FundingData>",
                          j.finalization AS "finalization: Json<StateData>"
                   FROM ai_financial_invocation j JOIN ai_financial_rate r ON r.version = j.rate_version
                   WHERE j.invocation_id = $1 FOR UPDATE OF j"#,
                id.as_uuid(),
            ).fetch_optional(&mut *tx).await?.ok_or(FinancialError::InvocationNotFound)?;
            let existing = row.record()?.ok_or(FinancialError::InvocationNotFound)?;
            if existing.admission != record.admission {
                return Err(conflict(id, ReplayPhase::Begin));
            }
            let disposition = if existing.state == InvocationState::Pending {
                let recovery_required = matches!(
                    record.state,
                    InvocationState::Unresolved { .. } | InvocationState::Unpriced { .. }
                );
                let data = Json(StateData::from_state(&record.state)?);
                sqlx::query!(
                    r#"UPDATE ai_financial_invocation SET finalization = $2,
                       recovery_required = $3, finalized_at = now() WHERE invocation_id = $1"#,
                    id.as_uuid(),
                    data as _,
                    recovery_required,
                )
                .execute(&mut *tx)
                .await?;
                WriteDisposition::Inserted
            } else {
                if existing.state != record.state {
                    return Err(conflict(id, ReplayPhase::Finalize));
                }
                WriteDisposition::Replayed
            };
            tx.commit().await?;
            Ok(Recorded {
                value: record,
                disposition,
            })
        })
    }

    fn acknowledge_funding(&self, id: InvocationId) -> FinancialFuture<'_, ()> {
        Box::pin(async move {
            let result = sqlx::query!(
                r#"UPDATE ai_financial_invocation SET funding_acknowledged = true
                   WHERE invocation_id = $1 AND finalization IS NOT NULL"#,
                id.as_uuid(),
            )
            .execute(&self.pool)
            .await?;
            if result.rows_affected() == 0 {
                return Err(FinancialError::InvocationNotFound);
            }
            Ok(())
        })
    }

    fn get(&self, id: InvocationId) -> FinancialFuture<'_, Option<InvocationRecord>> {
        Box::pin(async move {
            let row = sqlx::query_as!(
                JournalRow,
                r#"SELECT j.request AS "request: Json<RequestData>",
                          r.publication AS "publication: Json<RateData>",
                          j.funding AS "funding: Json<FundingData>",
                          j.finalization AS "finalization: Json<StateData>"
                   FROM ai_financial_invocation j JOIN ai_financial_rate r ON r.version = j.rate_version
                   WHERE j.invocation_id = $1"#,
                id.as_uuid(),
            ).fetch_optional(&self.pool).await?;
            match row {
                Some(row) => row.record(),
                None => Ok(None),
            }
        })
    }

    fn pending(&self, query: PendingInvocations) -> FinancialFuture<'_, Vec<InvocationRecord>> {
        Box::pin(async move {
            let rows = sqlx::query_as!(
                JournalRow,
                r#"SELECT j.request AS "request: Json<RequestData>",
                          r.publication AS "publication: Json<RateData>",
                          j.funding AS "funding: Json<FundingData>",
                          j.finalization AS "finalization: Json<StateData>"
                   FROM ai_financial_invocation j JOIN ai_financial_rate r ON r.version = j.rate_version
                   WHERE j.funding IS NOT NULL AND (j.recovery_required OR NOT j.funding_acknowledged)
                     AND ($1::uuid IS NULL OR j.invocation_id > $1) AND j.occurred_at < $2
                   ORDER BY j.invocation_id LIMIT $3"#,
                query.after.map(InvocationId::as_uuid), query.before, i64::from(query.limit.get()),
            ).fetch_all(&self.pool).await?;
            rows.into_iter()
                .map(|row| row.record()?.ok_or(FinancialError::InvocationNotFound))
                .collect()
        })
    }

    fn pending_admissions(
        &self,
        query: PendingInvocations,
    ) -> FinancialFuture<'_, Vec<PreparedInvocation>> {
        Box::pin(async move {
            let rows = sqlx::query_as!(
                JournalRow,
                r#"SELECT j.request AS "request: Json<RequestData>",
                          r.publication AS "publication: Json<RateData>",
                          j.funding AS "funding: Json<FundingData>",
                          j.finalization AS "finalization: Json<StateData>"
                   FROM ai_financial_invocation j JOIN ai_financial_rate r ON r.version = j.rate_version
                   WHERE j.funding IS NULL
                     AND ($1::uuid IS NULL OR j.invocation_id > $1) AND j.occurred_at < $2
                   ORDER BY j.invocation_id LIMIT $3"#,
                query.after.map(InvocationId::as_uuid), query.before, i64::from(query.limit.get()),
            ).fetch_all(&self.pool).await?;
            rows.into_iter().map(JournalRow::prepared).collect()
        })
    }
}

fn conflict(invocation_id: InvocationId, phase: ReplayPhase) -> FinancialError {
    FinancialError::ReplayConflict {
        invocation_id,
        phase,
    }
}

impl From<sqlx::Error> for FinancialError {
    fn from(error: sqlx::Error) -> Self {
        Self::Infrastructure(rootcause::report!(error).into_dynamic())
    }
}

// Explicit storage DTOs keep serialization outside the domain and preserve full u64
// precision and nanosecond evidence timestamps. JSON contains only the typed facts
// below, never arbitrary provider payloads. Decode through validated constructors.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestData {
    run_id: Uuid,
    invocation_id: Uuid,
    user_id: String,
    feature: crate::domain::AiFeature,
    entity: Option<Uuid>,
    provider: String,
    model: String,
    occurred_at: DateTime<Utc>,
    token_budget: [u64; 5],
}

impl From<&BeginInvocation> for RequestData {
    fn from(value: &BeginInvocation) -> Self {
        Self {
            run_id: value.run_id.as_uuid(),
            invocation_id: value.invocation_id.as_uuid(),
            user_id: value.user.as_ref().to_owned(),
            feature: value.feature,
            entity: value.entity,
            provider: value.model.provider().to_owned(),
            model: value.model.model().to_owned(),
            occurred_at: value.occurred_at,
            token_budget: token_array(value.token_budget),
        }
    }
}

impl RequestData {
    fn decode(self) -> FinancialResult<BeginInvocation> {
        Ok(BeginInvocation {
            run_id: self.run_id.try_into()?,
            invocation_id: self.invocation_id.try_into()?,
            user: MacroUserIdStr::try_from(self.user_id).map_err(|error| {
                FinancialError::Infrastructure(rootcause::report!(error).into_dynamic())
            })?,
            feature: self.feature,
            entity: self.entity,
            model: ProviderModel::new(self.provider, self.model)?,
            occurred_at: self.occurred_at,
            token_budget: tokens(self.token_budget),
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RateData {
    version: Uuid,
    provider: String,
    model: String,
    effective_at: DateTime<Utc>,
    valid_until: DateTime<Utc>,
    rates: [u64; 5],
    source: String,
    verified_at: DateTime<Utc>,
    cache_write_policy: CachePolicyData,
    counter_semantics: SemanticsData,
}

#[derive(Debug, Serialize, Deserialize)]
enum CachePolicyData {
    NotApplicable,
    ProviderDefault,
    FiveMinutes,
    OneHour,
}
#[derive(Debug, Serialize, Deserialize)]
enum SemanticsData {
    Disjoint,
    InclusiveTotals,
    InputInclusive,
    OutputInclusive,
}

impl From<&RatePublication> for RateData {
    fn from(value: &RatePublication) -> Self {
        let rate = &value.snapshot;
        Self {
            version: rate.version.as_uuid(),
            provider: rate.model.provider().to_owned(),
            model: rate.model.model().to_owned(),
            effective_at: rate.effective_at,
            valid_until: value.valid_until,
            rates: [
                rate.tokens.input,
                rate.tokens.output,
                rate.tokens.cache_read,
                rate.tokens.cache_write,
                rate.tokens.reasoning,
            ],
            source: value.source.clone(),
            verified_at: value.verified_at,
            cache_write_policy: match value.cache_write_policy {
                CacheWritePolicy::NotApplicable => CachePolicyData::NotApplicable,
                CacheWritePolicy::ProviderDefault => CachePolicyData::ProviderDefault,
                CacheWritePolicy::FiveMinutes => CachePolicyData::FiveMinutes,
                CacheWritePolicy::OneHour => CachePolicyData::OneHour,
            },
            counter_semantics: match value.counter_semantics {
                CounterSemantics::Disjoint => SemanticsData::Disjoint,
                CounterSemantics::InclusiveTotals => SemanticsData::InclusiveTotals,
                CounterSemantics::InputInclusive => SemanticsData::InputInclusive,
                CounterSemantics::OutputInclusive => SemanticsData::OutputInclusive,
            },
        }
    }
}

impl RateData {
    fn decode(self) -> FinancialResult<RatePublication> {
        let [input, output, cache_read, cache_write, reasoning] = self.rates;
        let publication = RatePublication {
            snapshot: RateSnapshot {
                version: self.version.try_into()?,
                model: ProviderModel::new(self.provider, self.model)?,
                effective_at: self.effective_at,
                tokens: TokenRates {
                    input,
                    output,
                    cache_read,
                    cache_write,
                    reasoning,
                },
            },
            valid_until: self.valid_until,
            source: self.source,
            verified_at: self.verified_at,
            cache_write_policy: match self.cache_write_policy {
                CachePolicyData::NotApplicable => CacheWritePolicy::NotApplicable,
                CachePolicyData::ProviderDefault => CacheWritePolicy::ProviderDefault,
                CachePolicyData::FiveMinutes => CacheWritePolicy::FiveMinutes,
                CachePolicyData::OneHour => CacheWritePolicy::OneHour,
            },
            counter_semantics: match self.counter_semantics {
                SemanticsData::Disjoint => CounterSemantics::Disjoint,
                SemanticsData::InclusiveTotals => CounterSemantics::InclusiveTotals,
                SemanticsData::InputInclusive => CounterSemantics::InputInclusive,
                SemanticsData::OutputInclusive => CounterSemantics::OutputInclusive,
            },
        };
        publication.validate()?;
        Ok(publication)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FundingData {
    id: Uuid,
    invocation_id: Uuid,
    maximum_public_usage: u64,
}

impl From<&FundingAuthorization> for FundingData {
    fn from(value: &FundingAuthorization) -> Self {
        Self {
            id: value.id.as_uuid(),
            invocation_id: value.invocation_id.as_uuid(),
            maximum_public_usage: value.maximum_public_usage.units(),
        }
    }
}

impl FundingData {
    fn decode(self) -> FinancialResult<FundingAuthorization> {
        Ok(FundingAuthorization {
            id: self.id.try_into()?,
            invocation_id: self.invocation_id.try_into()?,
            maximum_public_usage: PublicUsage::from_units(self.maximum_public_usage),
        })
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct EvidenceData {
    invocation_id: Uuid,
    occurred_at: DateTime<Utc>,
    provider_request_id: Option<String>,
    outcome: OutcomeData,
    usage: UsageData,
}

#[derive(Serialize, Deserialize)]
enum OutcomeData {
    Succeeded,
    Failed,
    Cancelled,
    Unknown,
}
#[derive(Serialize, Deserialize)]
enum UsageData {
    Reported([u64; 5]),
    UsageNotReported,
    Interrupted,
    UnsupportedDimensions,
}
#[derive(Serialize, Deserialize)]
enum ExclusionData {
    LegacyPolicy,
    ExemptFeature,
    InternalWork,
}
#[derive(Serialize, Deserialize)]
enum UnpricedData {
    MissingRate,
    ArithmeticOverflow,
}

impl From<&FinalizeInvocation> for EvidenceData {
    fn from(value: &FinalizeInvocation) -> Self {
        Self {
            invocation_id: value.invocation_id.as_uuid(),
            occurred_at: value.occurred_at,
            provider_request_id: value
                .provider_request_id
                .as_ref()
                .map(|id| id.as_str().to_owned()),
            outcome: match value.outcome {
                ProviderOutcome::Succeeded => OutcomeData::Succeeded,
                ProviderOutcome::Failed => OutcomeData::Failed,
                ProviderOutcome::Cancelled => OutcomeData::Cancelled,
                ProviderOutcome::Unknown => OutcomeData::Unknown,
            },
            usage: match value.usage {
                UsageEvidence::Reported(usage) => UsageData::Reported(token_array(usage)),
                UsageEvidence::Missing(UnresolvedReason::UsageNotReported) => {
                    UsageData::UsageNotReported
                }
                UsageEvidence::Missing(UnresolvedReason::Interrupted) => UsageData::Interrupted,
                UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions) => {
                    UsageData::UnsupportedDimensions
                }
            },
        }
    }
}

impl EvidenceData {
    fn decode(self) -> FinancialResult<FinalizeInvocation> {
        Ok(FinalizeInvocation {
            invocation_id: self.invocation_id.try_into()?,
            occurred_at: self.occurred_at,
            provider_request_id: self
                .provider_request_id
                .map(ProviderRequestId::new)
                .transpose()?,
            outcome: match self.outcome {
                OutcomeData::Succeeded => ProviderOutcome::Succeeded,
                OutcomeData::Failed => ProviderOutcome::Failed,
                OutcomeData::Cancelled => ProviderOutcome::Cancelled,
                OutcomeData::Unknown => ProviderOutcome::Unknown,
            },
            usage: match self.usage {
                UsageData::Reported(usage) => UsageEvidence::Reported(tokens(usage)),
                UsageData::UsageNotReported => {
                    UsageEvidence::Missing(UnresolvedReason::UsageNotReported)
                }
                UsageData::Interrupted => UsageEvidence::Missing(UnresolvedReason::Interrupted),
                UsageData::UnsupportedDimensions => {
                    UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions)
                }
            },
        })
    }
}

#[derive(Serialize, Deserialize)]
enum StateData {
    Priced {
        evidence: EvidenceData,
        public_usage: u64,
    },
    Unresolved {
        evidence: EvidenceData,
    },
    Unpriced {
        evidence: EvidenceData,
        reason: UnpricedData,
    },
    Excluded {
        evidence: EvidenceData,
        reason: ExclusionData,
    },
}

impl StateData {
    fn from_state(state: &InvocationState) -> FinancialResult<Self> {
        Ok(match state {
            InvocationState::Pending => return Err(FinancialError::InvalidTokenUsage),
            InvocationState::Priced {
                evidence,
                public_usage,
            } => Self::Priced {
                evidence: evidence.into(),
                public_usage: public_usage.units(),
            },
            InvocationState::Unresolved { evidence } => Self::Unresolved {
                evidence: evidence.into(),
            },
            InvocationState::Unpriced { evidence, reason } => Self::Unpriced {
                evidence: evidence.into(),
                reason: match reason {
                    UnpricedReason::MissingRate => UnpricedData::MissingRate,
                    UnpricedReason::ArithmeticOverflow => UnpricedData::ArithmeticOverflow,
                },
            },
            InvocationState::Excluded { evidence, reason } => Self::Excluded {
                evidence: evidence.into(),
                reason: match reason {
                    ExclusionReason::LegacyPolicy => ExclusionData::LegacyPolicy,
                    ExclusionReason::ExemptFeature => ExclusionData::ExemptFeature,
                    ExclusionReason::InternalWork => ExclusionData::InternalWork,
                },
            },
        })
    }

    fn decode(self) -> FinancialResult<InvocationState> {
        Ok(match self {
            Self::Priced {
                evidence,
                public_usage,
            } => InvocationState::Priced {
                evidence: evidence.decode()?,
                public_usage: PublicUsage::from_units(public_usage),
            },
            Self::Unresolved { evidence } => InvocationState::Unresolved {
                evidence: evidence.decode()?,
            },
            Self::Unpriced { evidence, reason } => InvocationState::Unpriced {
                evidence: evidence.decode()?,
                reason: match reason {
                    UnpricedData::MissingRate => UnpricedReason::MissingRate,
                    UnpricedData::ArithmeticOverflow => UnpricedReason::ArithmeticOverflow,
                },
            },
            Self::Excluded { evidence, reason } => InvocationState::Excluded {
                evidence: evidence.decode()?,
                reason: match reason {
                    ExclusionData::LegacyPolicy => ExclusionReason::LegacyPolicy,
                    ExclusionData::ExemptFeature => ExclusionReason::ExemptFeature,
                    ExclusionData::InternalWork => ExclusionReason::InternalWork,
                },
            },
        })
    }
}

struct JournalRow {
    request: Json<RequestData>,
    publication: Json<RateData>,
    funding: Option<Json<FundingData>>,
    finalization: Option<Json<StateData>>,
}

impl JournalRow {
    fn prepared(self) -> FinancialResult<PreparedInvocation> {
        Ok(PreparedInvocation {
            request: self.request.0.decode()?,
            rate: self.publication.0.decode()?.snapshot,
            funding: self.funding.map(|data| data.0.decode()).transpose()?,
        })
    }

    fn record(self) -> FinancialResult<Option<InvocationRecord>> {
        let state = self
            .finalization
            .map(|data| data.0.decode())
            .transpose()?
            .unwrap_or(InvocationState::Pending);
        let prepared = Self {
            finalization: None,
            ..self
        }
        .prepared()?;
        Ok(prepared.funding.map(|funding| InvocationRecord {
            admission: AuthorizedInvocation {
                request: prepared.request,
                rate: prepared.rate,
                funding,
            },
            state,
        }))
    }
}

fn token_array(tokens: TrustedTokenUsage) -> [u64; 5] {
    [
        tokens.input(),
        tokens.output(),
        tokens.cache_read(),
        tokens.cache_write(),
        tokens.reasoning(),
    ]
}

fn tokens([input, output, cache_read, cache_write, reasoning]: [u64; 5]) -> TrustedTokenUsage {
    TrustedTokenUsage::from_disjoint(input, output, cache_read, cache_write, reasoning)
}
