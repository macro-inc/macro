//! The index table. Items (string `pk`/`sk`; `gsi1` on `gsi1pk`/`gsi1sk`):
//!
//! | Item | `pk` | `sk` | `gsi1pk` / `gsi1sk` |
//! | --- | --- | --- | --- |
//! | Device credential | `CREDENTIAL#<sha256 of secret>` | `CREDENTIAL` | `CREDENTIALS` / `<id>` |
//! | Credential by id | `CREDENTIAL_ID#<id>` | `CREDENTIAL_ID` (`credential_pk`) | |
//! | Commit | `COMMIT#<sha>` | `COMMIT` | |
//! | Session | `SESSION#<session id>` | `SESSION` | `EXTERNAL_SESSION#<agent's id>` / `SESSION#<session id>` |
//! | Transcript chunk | `SESSION#<session id>` | `CHUNK#<first ts, 10 digits>#<chunk id>` | |
//! | Token bucket | `SESSION#<session id>` | `TOKENS#<model>#<speed>#<bucket ts>` | |
//!
//! A session's chunks sort by first event time, so the read API pages a
//! transcript with one `Query` on `begins_with(sk, "CHUNK#")`.

use std::collections::{HashMap, HashSet};

use aws_sdk_dynamodb::error::SdkError;
use aws_sdk_dynamodb::operation::transact_write_items::TransactWriteItemsError;
use aws_sdk_dynamodb::types::{
    AttributeValue, KeysAndAttributes, Put, ReturnValue, TransactWriteItem, Update,
};
use chrono::{DateTime, Utc};

use crate::domain::ingest::{CommitRecord, SessionChunk, TokenBucket, TokenCounts, TokenDelta};
use crate::domain::models::{CredentialHash, CredentialId, CredentialInfo};
use crate::domain::ports::{IndexStore, SessionUpdate, StoredCredential};

#[cfg(test)]
mod test;

const PK: &str = "pk";
const SK: &str = "sk";
const GSI1: &str = "gsi1";
const GSI1PK: &str = "gsi1pk";
const GSI1SK: &str = "gsi1sk";

const CREDENTIAL_SK: &str = "CREDENTIAL";
const CREDENTIAL_ID_SK: &str = "CREDENTIAL_ID";
/// The credential item a credential-by-id item points at.
const CREDENTIAL_PK_ATTRIBUTE: &str = "credential_pk";
const CREDENTIALS_GSI1PK: &str = "CREDENTIALS";
const COMMIT_SK: &str = "COMMIT";
const SESSION_SK: &str = "SESSION";

/// Times a token bucket is re-read after a concurrent revision won the race.
const TOKEN_BUCKET_ATTEMPTS: usize = 3;

/// `BatchGetItem` takes at most 100 keys.
const BATCH_GET_LIMIT: usize = 100;
/// Rounds of retrying unprocessed `BatchGetItem` keys before giving up.
const BATCH_GET_ROUNDS: usize = 5;

/// The service's single table: string keys `pk`/`sk`, one global secondary
/// index `gsi1` on `gsi1pk`/`gsi1sk`, and TTL on `expires_at` (epoch seconds).
pub struct DynamoIndex {
    client: aws_sdk_dynamodb::Client,
    table: String,
}

/// A DynamoDB call failed or returned an item this code cannot read.
#[derive(Debug, thiserror::Error)]
pub enum DynamoIndexError {
    /// The request failed.
    #[error("DynamoDB request failed: {0}")]
    Request(#[source] Box<aws_sdk_dynamodb::Error>),
    /// An item did not (de)serialize.
    #[error("DynamoDB item mapping failed: {0}")]
    Mapping(#[from] serde_dynamo::Error),
    /// `BatchGetItem` kept returning unprocessed keys.
    #[error("DynamoDB left keys unprocessed")]
    Unprocessed,
    /// A token bucket kept changing under a concurrent writer.
    #[error("a token bucket kept changing while it was recorded")]
    Contended,
}

impl<E> From<SdkError<E>> for DynamoIndexError
where
    aws_sdk_dynamodb::Error: From<SdkError<E>>,
{
    fn from(error: SdkError<E>) -> Self {
        Self::Request(Box::new(error.into()))
    }
}

/// Whether a request failed only because its condition was false.
fn is_condition_failure<E: aws_sdk_dynamodb::error::ProvideErrorMetadata>(
    error: &SdkError<E>,
) -> bool {
    error
        .as_service_error()
        .and_then(|e| e.code())
        .is_some_and(|code| code == "ConditionalCheckFailedException")
}

/// Whether a transaction was cancelled because a condition was false.
fn is_transaction_condition_failure(error: &SdkError<TransactWriteItemsError>) -> bool {
    let Some(TransactWriteItemsError::TransactionCanceledException(cancelled)) =
        error.as_service_error()
    else {
        return false;
    };
    cancelled
        .cancellation_reasons()
        .iter()
        .any(|reason| reason.code() == Some("ConditionalCheckFailed"))
}

fn build_error(error: aws_sdk_dynamodb::error::BuildError) -> DynamoIndexError {
    DynamoIndexError::Request(Box::new(error.into()))
}

fn s(value: impl Into<String>) -> AttributeValue {
    AttributeValue::S(value.into())
}

fn n(value: impl ToString) -> AttributeValue {
    AttributeValue::N(value.to_string())
}

fn credential_pk(hash: &CredentialHash) -> String {
    format!("CREDENTIAL#{}", hash.as_str())
}

fn credential_id_pk(id: CredentialId) -> String {
    format!("CREDENTIAL_ID#{id}")
}

fn session_pk(session_id: &str) -> String {
    format!("SESSION#{session_id}")
}

/// A number attribute of an item, or zero.
fn number(item: &HashMap<String, AttributeValue>, name: &str) -> u64 {
    item.get(name)
        .and_then(|value| value.as_n().ok())
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

impl DynamoIndex {
    /// The index stored in `table`.
    pub fn new(client: aws_sdk_dynamodb::Client, table: String) -> Self {
        Self { client, table }
    }

    /// The table key of the credential with this id, read consistently from
    /// its credential-by-id item, so a revoke right after a mint finds it.
    async fn credential_key(
        &self,
        id: CredentialId,
    ) -> Result<Option<AttributeValue>, DynamoIndexError> {
        let output = self
            .client
            .get_item()
            .table_name(&self.table)
            .key(PK, s(credential_id_pk(id)))
            .key(SK, s(CREDENTIAL_ID_SK))
            .consistent_read(true)
            .send()
            .await?;
        Ok(output
            .item
            .and_then(|mut item| item.remove(CREDENTIAL_PK_ATTRIBUTE)))
    }

    /// The update adding a token change to a session's counters; `None` when
    /// nothing changed.
    fn add_tokens(&self, pk: &str, delta: &TokenDelta) -> Result<Option<Update>, DynamoIndexError> {
        let counters = [
            ("input_tokens", delta.input),
            ("output_tokens", delta.output),
            ("cache_read_tokens", delta.cache_read),
            ("cache_write_tokens", delta.cache_write),
            ("cost_micro_usd", delta.cost_micro_usd),
        ];
        let mut update = Update::builder()
            .table_name(&self.table)
            .key(PK, s(pk))
            .key(SK, s(SESSION_SK));
        let mut adds = Vec::new();
        for (name, change) in counters {
            if change != 0 {
                update = update
                    .expression_attribute_names(format!("#{name}"), name)
                    .expression_attribute_values(format!(":{name}"), n(change));
                adds.push(format!("#{name} :{name}"));
            }
        }
        if adds.is_empty() {
            return Ok(None);
        }
        let update = update
            .update_expression(format!("ADD {}", adds.join(", ")))
            .build()
            .map_err(build_error)?;
        Ok(Some(update))
    }

    /// Keeps the earliest `first_seen` and latest `last_seen` across
    /// updates. Each runs only when the stored value is beaten, and its
    /// condition makes it safe against a concurrent update.
    async fn widen_session_range(
        &self,
        session_id: &str,
        old: &HashMap<String, AttributeValue>,
        update: &SessionUpdate,
    ) -> Result<(), DynamoIndexError> {
        let ranges = [
            ("first_seen", update.first_seen, "#a > :v", true),
            ("last_seen", update.last_seen, "#a < :v", false),
        ];
        for (attribute, value, condition, wants_lower) in ranges {
            let Some(value) = value else { continue };
            if !old.contains_key(attribute) {
                continue;
            }
            let stored = number(old, attribute);
            let beaten = if wants_lower {
                value < stored
            } else {
                value > stored
            };
            if !beaten {
                continue;
            }
            let result = self
                .client
                .update_item()
                .table_name(&self.table)
                .key(PK, s(session_pk(session_id)))
                .key(SK, s(SESSION_SK))
                .update_expression("SET #a = :v")
                .condition_expression(condition)
                .expression_attribute_names("#a", attribute)
                .expression_attribute_values(":v", n(value))
                .send()
                .await;
            match result {
                Ok(_) => {}
                Err(error) if is_condition_failure(&error) => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }
}

impl IndexStore for DynamoIndex {
    type Err = DynamoIndexError;

    #[tracing::instrument(name = "gitai.dynamodb.insert_credential", skip_all, fields(credential_id = %credential.info.id), err)]
    async fn insert_credential(&self, credential: &StoredCredential) -> Result<(), Self::Err> {
        let mut item: HashMap<String, AttributeValue> = serde_dynamo::to_item(&credential.info)?;
        item.insert(PK.to_owned(), s(credential_pk(&credential.hash)));
        item.insert(SK.to_owned(), s(CREDENTIAL_SK));
        item.insert(GSI1PK.to_owned(), s(CREDENTIALS_GSI1PK));
        item.insert(GSI1SK.to_owned(), s(credential.info.id.to_string()));
        let credential_item = Put::builder()
            .table_name(&self.table)
            .set_item(Some(item))
            .condition_expression("attribute_not_exists(pk)")
            .build()
            .map_err(build_error)?;
        let by_id = Put::builder()
            .table_name(&self.table)
            .item(PK, s(credential_id_pk(credential.info.id)))
            .item(SK, s(CREDENTIAL_ID_SK))
            .item(CREDENTIAL_PK_ATTRIBUTE, s(credential_pk(&credential.hash)))
            .condition_expression("attribute_not_exists(pk)")
            .build()
            .map_err(build_error)?;
        self.client
            .transact_write_items()
            .transact_items(TransactWriteItem::builder().put(credential_item).build())
            .transact_items(TransactWriteItem::builder().put(by_id).build())
            .send()
            .await?;
        Ok(())
    }

    #[tracing::instrument(name = "gitai.dynamodb.credential_by_hash", skip_all, err)]
    async fn credential_by_hash(
        &self,
        hash: &CredentialHash,
    ) -> Result<Option<CredentialInfo>, Self::Err> {
        let output = self
            .client
            .get_item()
            .table_name(&self.table)
            .key(PK, s(credential_pk(hash)))
            .key(SK, s(CREDENTIAL_SK))
            .consistent_read(true)
            .send()
            .await?;
        let Some(item) = output.item else {
            return Ok(None);
        };
        Ok(Some(serde_dynamo::from_item(item)?))
    }

    #[tracing::instrument(name = "gitai.dynamodb.list_credentials", skip_all, err)]
    async fn list_credentials(&self) -> Result<Vec<CredentialInfo>, Self::Err> {
        let mut credentials = Vec::new();
        let mut start_key = None;
        loop {
            let output = self
                .client
                .query()
                .table_name(&self.table)
                .index_name(GSI1)
                .key_condition_expression("#gpk = :gpk")
                .expression_attribute_names("#gpk", GSI1PK)
                .expression_attribute_values(":gpk", s(CREDENTIALS_GSI1PK))
                .set_exclusive_start_key(start_key)
                .send()
                .await?;
            for item in output.items.unwrap_or_default() {
                credentials.push(serde_dynamo::from_item(item)?);
            }
            start_key = output.last_evaluated_key;
            if start_key.is_none() {
                return Ok(credentials);
            }
        }
    }

    #[tracing::instrument(name = "gitai.dynamodb.revoke_credential", skip(self, at), err)]
    async fn revoke_credential(
        &self,
        id: CredentialId,
        at: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let Some(pk) = self.credential_key(id).await? else {
            return Ok(false);
        };
        // Keep the first revocation time. A credential written before
        // optional fields were omitted may hold an explicit NULL, which
        // `if_not_exists` would treat as present.
        let result = self
            .client
            .update_item()
            .table_name(&self.table)
            .key(PK, pk)
            .key(SK, s(CREDENTIAL_SK))
            .update_expression("SET revoked_at = :at")
            .condition_expression(
                "attribute_exists(pk) AND (attribute_not_exists(revoked_at) OR attribute_type(revoked_at, :null))",
            )
            .expression_attribute_values(":at", s(at.to_rfc3339()))
            .expression_attribute_values(":null", s("NULL"))
            .send()
            .await;
        match result {
            Ok(_) => Ok(true),
            // The credential exists, so a false condition means already revoked.
            Err(error) if is_condition_failure(&error) => Ok(true),
            Err(error) => Err(error.into()),
        }
    }

    #[tracing::instrument(name = "gitai.dynamodb.touch_credential", skip_all, err)]
    async fn touch_credential(
        &self,
        hash: &CredentialHash,
        at: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        let result = self
            .client
            .update_item()
            .table_name(&self.table)
            .key(PK, s(credential_pk(hash)))
            .key(SK, s(CREDENTIAL_SK))
            .update_expression("SET last_used_at = :at")
            .condition_expression("attribute_exists(pk)")
            .expression_attribute_values(":at", s(at.to_rfc3339()))
            .send()
            .await;
        match result {
            Ok(_) => Ok(()),
            Err(error) if is_condition_failure(&error) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    #[tracing::instrument(name = "gitai.dynamodb.put_commit", skip_all, fields(commit = %commit.sha), err)]
    async fn put_commit(&self, commit: &CommitRecord) -> Result<bool, Self::Err> {
        let mut item: HashMap<String, AttributeValue> = serde_dynamo::to_item(commit)?;
        item.insert(PK.to_owned(), s(format!("COMMIT#{}", commit.sha)));
        item.insert(SK.to_owned(), s(COMMIT_SK));
        let session_ids = commit
            .sessions
            .iter()
            .map(|session| s(session.session_id.clone()))
            .collect();
        item.insert("session_ids".to_owned(), AttributeValue::L(session_ids));
        let output = self
            .client
            .put_item()
            .table_name(&self.table)
            .set_item(Some(item))
            .return_values(ReturnValue::AllOld)
            .send()
            .await?;
        Ok(output.attributes.is_none_or(|old| old.is_empty()))
    }

    #[tracing::instrument(name = "gitai.dynamodb.known_commits", skip_all, fields(commits = shas.len()), err)]
    async fn known_commits(&self, shas: &[String]) -> Result<HashSet<String>, Self::Err> {
        let mut known = HashSet::new();
        for page in shas.chunks(BATCH_GET_LIMIT) {
            let keys = page
                .iter()
                .collect::<HashSet<_>>()
                .into_iter()
                .map(|sha| {
                    HashMap::from([
                        (PK.to_owned(), s(format!("COMMIT#{sha}"))),
                        (SK.to_owned(), s(COMMIT_SK)),
                    ])
                })
                .collect();
            let mut request = Some(
                KeysAndAttributes::builder()
                    .set_keys(Some(keys))
                    .projection_expression("sha")
                    .build()
                    .map_err(|error| DynamoIndexError::Request(Box::new(error.into())))?,
            );
            for _ in 0..BATCH_GET_ROUNDS {
                let Some(keys) = request.take() else { break };
                let output = self
                    .client
                    .batch_get_item()
                    .request_items(&self.table, keys)
                    .send()
                    .await?;
                let items = output
                    .responses
                    .and_then(|mut responses| responses.remove(&self.table))
                    .unwrap_or_default();
                for item in items {
                    if let Some(Ok(sha)) = item.get("sha").map(AttributeValue::as_s) {
                        known.insert(sha.clone());
                    }
                }
                request = output
                    .unprocessed_keys
                    .and_then(|mut unprocessed| unprocessed.remove(&self.table));
            }
            if request.is_some() {
                return Err(DynamoIndexError::Unprocessed);
            }
        }
        Ok(known)
    }

    #[tracing::instrument(name = "gitai.dynamodb.put_session_chunk", skip_all, fields(session_id = %chunk.session_id, events = chunk.events.len()), err)]
    async fn put_session_chunk(
        &self,
        chunk: &SessionChunk,
        s3_key: &str,
    ) -> Result<bool, Self::Err> {
        let pk = session_pk(&chunk.session_id);
        let put = Put::builder()
            .table_name(&self.table)
            .item(PK, s(pk.clone()))
            .item(
                SK,
                s(format!("CHUNK#{:010}#{}", chunk.first_ts, chunk.chunk_id)),
            )
            .item("s3_key", s(s3_key))
            .item("event_count", n(chunk.events.len()))
            .item("first_ts", n(chunk.first_ts))
            .item("last_ts", n(chunk.last_ts))
            .condition_expression("attribute_not_exists(pk)")
            .build()
            .map_err(build_error)?;
        let count = Update::builder()
            .table_name(&self.table)
            .key(PK, s(pk))
            .key(SK, s(SESSION_SK))
            .update_expression("ADD #count :count")
            .expression_attribute_names("#count", "event_count")
            .expression_attribute_values(":count", n(chunk.events.len()))
            .build()
            .map_err(build_error)?;

        let result = self
            .client
            .transact_write_items()
            .transact_items(TransactWriteItem::builder().put(put).build())
            .transact_items(TransactWriteItem::builder().update(count).build())
            .send()
            .await;
        match result {
            Ok(_) => Ok(true),
            Err(error) if is_transaction_condition_failure(&error) => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    /// Reads the stored revision, then writes the new one together with the
    /// session's counter change, on condition that the stored revision is
    /// still the one read. A concurrent revision makes it read again.
    #[tracing::instrument(name = "gitai.dynamodb.record_token_bucket", skip_all, fields(session_id = %bucket.session_id), err)]
    async fn record_token_bucket(
        &self,
        bucket: &TokenBucket,
    ) -> Result<Option<TokenDelta>, Self::Err> {
        let pk = session_pk(&bucket.session_id);
        let sk = format!(
            "TOKENS#{}#{}#{:010}",
            bucket.model, bucket.speed, bucket.bucket_ts
        );
        let mut item: HashMap<String, AttributeValue> = serde_dynamo::to_item(bucket)?;
        item.insert(PK.to_owned(), s(pk.clone()));
        item.insert(SK.to_owned(), s(sk.clone()));

        for _ in 0..TOKEN_BUCKET_ATTEMPTS {
            let stored = self
                .client
                .get_item()
                .table_name(&self.table)
                .key(PK, s(pk.clone()))
                .key(SK, s(sk.clone()))
                .consistent_read(true)
                .send()
                .await?
                .item;
            let stored_seq = stored.as_ref().map(|old| number(old, "emitted_seq"));
            if stored_seq.is_some_and(|seq| seq >= bucket.emitted_seq) {
                return Ok(None);
            }
            let old = stored.unwrap_or_default();
            let previous = TokenCounts {
                input: number(&old, "input"),
                output: number(&old, "output"),
                cache_read: number(&old, "cache_read"),
                cache_write: number(&old, "cache_write"),
                cost_micro_usd: number(&old, "cost_micro_usd"),
            };
            let delta = bucket.counts.delta_since(&previous);

            let put = Put::builder()
                .table_name(&self.table)
                .set_item(Some(item.clone()));
            let put = match stored_seq {
                Some(seq) => put
                    .condition_expression("emitted_seq = :seq")
                    .expression_attribute_values(":seq", n(seq)),
                None => put.condition_expression("attribute_not_exists(pk)"),
            };
            let mut transaction = self.client.transact_write_items().transact_items(
                TransactWriteItem::builder()
                    .put(put.build().map_err(build_error)?)
                    .build(),
            );
            if let Some(counters) = self.add_tokens(&pk, &delta)? {
                transaction = transaction
                    .transact_items(TransactWriteItem::builder().update(counters).build());
            }

            match transaction.send().await {
                Ok(_) => return Ok(Some(delta)),
                Err(error) if is_transaction_condition_failure(&error) => continue,
                Err(error) => return Err(error.into()),
            }
        }
        Err(DynamoIndexError::Contended)
    }

    #[tracing::instrument(name = "gitai.dynamodb.update_session", skip_all, fields(session_id = %update.session_id), err)]
    async fn update_session(&self, update: &SessionUpdate) -> Result<bool, Self::Err> {
        // Every attribute goes through `#name`, so no name can collide with a
        // DynamoDB reserved word.
        let mut sets = Vec::new();
        let mut adds = Vec::new();
        let mut names = HashMap::new();
        let mut values = HashMap::new();
        let mut alias = |name: &str, value: AttributeValue| {
            names.insert(format!("#{name}"), name.to_owned());
            values.insert(format!(":{name}"), value);
        };

        alias("session_id", s(update.session_id.clone()));
        sets.push("#session_id = :session_id".to_owned());

        // First writer wins for what does not change over a session.
        let external_index = update.external_session_id.as_ref().map(|external| {
            (
                s(format!("EXTERNAL_SESSION#{external}")),
                s(session_pk(&update.session_id)),
            )
        });
        let set_once = [
            (
                "external_session_id",
                update.external_session_id.clone().map(s),
            ),
            ("tool", update.tool.clone().map(s)),
            ("repository", update.repository.clone().map(s)),
            (
                "author",
                update.author.as_ref().map(|email| s(email.as_str())),
            ),
            (
                "hostname",
                update.hostname.as_ref().map(|host| s(host.as_str())),
            ),
            ("transcript_prefix", update.transcript_prefix.clone().map(s)),
            ("first_seen", update.first_seen.map(n)),
            ("last_seen", update.last_seen.map(n)),
            (GSI1PK, external_index.as_ref().map(|(pk, _)| pk.clone())),
            (GSI1SK, external_index.map(|(_, sk)| sk)),
        ];
        for (name, value) in set_once {
            if let Some(value) = value {
                alias(name, value);
                sets.push(format!("#{name} = if_not_exists(#{name}, :{name})"));
            }
        }

        // The latest known model wins.
        if let Some(model) = update
            .model
            .as_ref()
            .filter(|model| model.as_str() != "unknown")
        {
            alias("model", s(model.clone()));
            sets.push("#model = :model".to_owned());
        }

        if !update.commit_shas.is_empty() {
            alias(
                "commit_shas",
                AttributeValue::Ss(update.commit_shas.clone()),
            );
            adds.push("#commit_shas :commit_shas".to_owned());
        }

        let mut expression = format!("SET {}", sets.join(", "));
        if !adds.is_empty() {
            expression.push_str(&format!(" ADD {}", adds.join(", ")));
        }
        let output = self
            .client
            .update_item()
            .table_name(&self.table)
            .key(PK, s(session_pk(&update.session_id)))
            .key(SK, s(SESSION_SK))
            .update_expression(expression)
            .set_expression_attribute_names(Some(names))
            .set_expression_attribute_values(Some(values))
            .return_values(ReturnValue::AllOld)
            .send()
            .await?;
        let old = output.attributes.unwrap_or_default();
        self.widen_session_range(&update.session_id, &old, update)
            .await?;
        Ok(old.is_empty())
    }
}
