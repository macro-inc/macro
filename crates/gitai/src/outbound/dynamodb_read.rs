//! The read API's view of the index table (layout in `dynamodb.rs` and
//! `AGENTS.md`), plus its GitHub cache items:
//!
//! | Item | `pk` | `sk` | Attributes |
//! | --- | --- | --- | --- |
//! | Pull request commits | `PR#macro-inc/macro#<n>` | `PR` | `commits` (L), `open`, `expires_at` |
//! | Commit's pull request | `GHCOMMIT#<sha>` | `GHCOMMIT` | `pr_number` (absent when none), `expires_at` |
//!
//! `expires_at` (epoch seconds) is the table's TTL attribute; TTL deletes
//! lazily, so readers check it too.

use std::collections::{HashMap, HashSet};

use aws_sdk_dynamodb::types::{AttributeValue, KeysAndAttributes};
use chrono::DateTime;
use serde::Deserialize;

use super::dynamodb::DynamoIndexError;
use crate::domain::read::models::{
    CachedPullRequest, CommitPullRequestLink, CommitSession, GITHUB_REPOSITORY, StoredCommit,
    StoredSession, Tokens, TranscriptChunk,
};
use crate::domain::read::ports::ReadIndex;

const PK: &str = "pk";
const SK: &str = "sk";
const COMMIT_SK: &str = "COMMIT";
const SESSION_SK: &str = "SESSION";
const PULL_REQUEST_SK: &str = "PR";
const COMMIT_LINK_SK: &str = "GHCOMMIT";
const CHUNK_SK_PREFIX: &str = "CHUNK#";
/// Sorts after every `CHUNK#<digits>#<hex>` key and before `SESSION`.
const CHUNK_SK_END: &str = "CHUNK#~";
const EXPIRES_AT: &str = "expires_at";

/// `BatchGetItem` takes at most 100 keys.
const BATCH_GET_LIMIT: usize = 100;
/// Rounds of retrying unprocessed `BatchGetItem` keys before giving up.
const BATCH_GET_ROUNDS: usize = 5;

/// Reads of the index table for the read API.
pub struct DynamoReadIndex {
    client: aws_sdk_dynamodb::Client,
    table: String,
}

#[derive(Deserialize)]
struct CommitRow {
    sha: String,
    #[serde(default)]
    ai_lines: u64,
    #[serde(default)]
    human_lines: u64,
    #[serde(default)]
    sessions: Vec<CommitSessionRow>,
    note_key: Option<String>,
    author: Option<String>,
}

#[derive(Deserialize)]
struct CommitSessionRow {
    session_id: String,
    tool: Option<String>,
    model: Option<String>,
}

#[derive(Deserialize)]
struct SessionRow {
    session_id: String,
    tool: Option<String>,
    model: Option<String>,
    author: Option<String>,
    repository: Option<String>,
    first_seen: Option<u64>,
    last_seen: Option<u64>,
    #[serde(default)]
    event_count: u64,
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_read_tokens: u64,
    #[serde(default)]
    cache_write_tokens: u64,
    #[serde(default)]
    cost_micro_usd: u64,
    #[serde(default)]
    commit_shas: Vec<String>,
}

#[derive(Deserialize)]
struct ChunkRow {
    sk: String,
    s3_key: String,
}

#[derive(Deserialize)]
struct PullRequestRow {
    commits: Vec<String>,
    open: bool,
    expires_at: i64,
}

#[derive(Deserialize)]
struct CommitLinkRow {
    pr_number: Option<u64>,
    expires_at: i64,
}

fn s(value: impl Into<String>) -> AttributeValue {
    AttributeValue::S(value.into())
}

fn key(pk: String, sk: &str) -> HashMap<String, AttributeValue> {
    HashMap::from([(PK.to_owned(), s(pk)), (SK.to_owned(), s(sk))])
}

fn pull_request_pk(number: u64) -> String {
    format!("PR#{GITHUB_REPOSITORY}#{number}")
}

fn commit_link_pk(sha: &str) -> String {
    format!("GHCOMMIT#{sha}")
}

impl DynamoReadIndex {
    /// Reads of `table`.
    pub fn new(client: aws_sdk_dynamodb::Client, table: String) -> Self {
        Self { client, table }
    }

    /// Every item with one of `keys`, in no particular order.
    async fn batch_get(
        &self,
        keys: Vec<HashMap<String, AttributeValue>>,
    ) -> Result<Vec<HashMap<String, AttributeValue>>, DynamoIndexError> {
        let mut items = Vec::new();
        for page in keys.chunks(BATCH_GET_LIMIT) {
            let mut request = Some(
                KeysAndAttributes::builder()
                    .set_keys(Some(page.to_vec()))
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
                items.extend(
                    output
                        .responses
                        .and_then(|mut responses| responses.remove(&self.table))
                        .unwrap_or_default(),
                );
                request = output
                    .unprocessed_keys
                    .and_then(|mut unprocessed| unprocessed.remove(&self.table));
            }
            if request.is_some() {
                return Err(DynamoIndexError::Unprocessed);
            }
        }
        Ok(items)
    }

    async fn get(
        &self,
        key: HashMap<String, AttributeValue>,
    ) -> Result<Option<HashMap<String, AttributeValue>>, DynamoIndexError> {
        let output = self
            .client
            .get_item()
            .table_name(&self.table)
            .set_key(Some(key))
            .send()
            .await?;
        Ok(output.item)
    }
}

/// Distinct keys of `ids` under one sort key.
fn distinct_keys(
    ids: &[String],
    pk_prefix: &str,
    sk: &str,
) -> Vec<HashMap<String, AttributeValue>> {
    ids.iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .map(|id| key(format!("{pk_prefix}{id}"), sk))
        .collect()
}

/// An `expires_at` as a time; out of range counts as already expired.
fn expiry(epoch_seconds: i64) -> chrono::DateTime<chrono::Utc> {
    DateTime::from_timestamp(epoch_seconds, 0).unwrap_or(DateTime::UNIX_EPOCH)
}

impl ReadIndex for DynamoReadIndex {
    type Err = DynamoIndexError;

    #[tracing::instrument(name = "gitai.dynamodb.read_commits", skip_all, fields(commits = shas.len()), err)]
    async fn commits(&self, shas: &[String]) -> Result<Vec<StoredCommit>, Self::Err> {
        let items = self
            .batch_get(distinct_keys(shas, "COMMIT#", COMMIT_SK))
            .await?;
        items
            .into_iter()
            .map(|item| {
                let row: CommitRow = serde_dynamo::from_item(item)?;
                Ok(StoredCommit {
                    sha: row.sha,
                    ai_lines: row.ai_lines,
                    human_lines: row.human_lines,
                    sessions: row
                        .sessions
                        .into_iter()
                        .map(|session| CommitSession {
                            session_id: session.session_id,
                            tool: session.tool,
                            model: session.model,
                        })
                        .collect(),
                    note_key: row.note_key,
                    author: row.author,
                })
            })
            .collect()
    }

    #[tracing::instrument(name = "gitai.dynamodb.read_sessions", skip_all, fields(sessions = ids.len()), err)]
    async fn sessions(&self, ids: &[String]) -> Result<Vec<StoredSession>, Self::Err> {
        let items = self
            .batch_get(distinct_keys(ids, "SESSION#", SESSION_SK))
            .await?;
        items
            .into_iter()
            .map(|item| {
                let row: SessionRow = serde_dynamo::from_item(item)?;
                Ok(StoredSession {
                    id: row.session_id,
                    tool: row.tool,
                    model: row.model,
                    author: row.author,
                    repository: row.repository,
                    first_seen: row.first_seen,
                    last_seen: row.last_seen,
                    event_count: row.event_count,
                    tokens: Tokens {
                        input: row.input_tokens,
                        output: row.output_tokens,
                        cache_read: row.cache_read_tokens,
                        cache_write: row.cache_write_tokens,
                    },
                    cost_micro_usd: row.cost_micro_usd,
                    commit_shas: row.commit_shas,
                })
            })
            .collect()
    }

    #[tracing::instrument(name = "gitai.dynamodb.transcript_chunks", skip(self, from), err)]
    async fn transcript_chunks(
        &self,
        session_id: &str,
        from: Option<&str>,
    ) -> Result<Vec<TranscriptChunk>, Self::Err> {
        let from = from
            .filter(|from| from.starts_with(CHUNK_SK_PREFIX))
            .unwrap_or(CHUNK_SK_PREFIX);
        let mut chunks = Vec::new();
        let mut start_key = None;
        loop {
            let output = self
                .client
                .query()
                .table_name(&self.table)
                .key_condition_expression("#pk = :pk AND #sk BETWEEN :from AND :end")
                .expression_attribute_names("#pk", PK)
                .expression_attribute_names("#sk", SK)
                .expression_attribute_values(":pk", s(format!("SESSION#{session_id}")))
                .expression_attribute_values(":from", s(from))
                .expression_attribute_values(":end", s(CHUNK_SK_END))
                .projection_expression("#sk, s3_key")
                .set_exclusive_start_key(start_key)
                .send()
                .await?;
            for item in output.items.unwrap_or_default() {
                let row: ChunkRow = serde_dynamo::from_item(item)?;
                chunks.push(TranscriptChunk {
                    sort_key: row.sk,
                    s3_key: row.s3_key,
                });
            }
            start_key = output.last_evaluated_key;
            if start_key.is_none() {
                return Ok(chunks);
            }
        }
    }

    #[tracing::instrument(name = "gitai.dynamodb.cached_pull_request", skip(self), err)]
    async fn cached_pull_request(
        &self,
        number: u64,
    ) -> Result<Option<CachedPullRequest>, Self::Err> {
        let Some(item) = self
            .get(key(pull_request_pk(number), PULL_REQUEST_SK))
            .await?
        else {
            return Ok(None);
        };
        let row: PullRequestRow = serde_dynamo::from_item(item)?;
        Ok(Some(CachedPullRequest {
            number,
            commits: row.commits,
            open: row.open,
            expires_at: expiry(row.expires_at),
        }))
    }

    #[tracing::instrument(name = "gitai.dynamodb.cache_pull_request", skip_all, fields(pr = pull_request.number), err)]
    async fn cache_pull_request(&self, pull_request: &CachedPullRequest) -> Result<(), Self::Err> {
        let commits = pull_request
            .commits
            .iter()
            .map(|sha| s(sha.clone()))
            .collect();
        let mut item = key(pull_request_pk(pull_request.number), PULL_REQUEST_SK);
        item.insert("commits".to_owned(), AttributeValue::L(commits));
        item.insert("open".to_owned(), AttributeValue::Bool(pull_request.open));
        item.insert(
            EXPIRES_AT.to_owned(),
            AttributeValue::N(pull_request.expires_at.timestamp().to_string()),
        );
        self.client
            .put_item()
            .table_name(&self.table)
            .set_item(Some(item))
            .send()
            .await?;
        Ok(())
    }

    #[tracing::instrument(name = "gitai.dynamodb.cached_commit_link", skip(self), err)]
    async fn cached_commit_link(
        &self,
        sha: &str,
    ) -> Result<Option<CommitPullRequestLink>, Self::Err> {
        let Some(item) = self.get(key(commit_link_pk(sha), COMMIT_LINK_SK)).await? else {
            return Ok(None);
        };
        let row: CommitLinkRow = serde_dynamo::from_item(item)?;
        Ok(Some(CommitPullRequestLink {
            sha: sha.to_owned(),
            pr_number: row.pr_number,
            expires_at: expiry(row.expires_at),
        }))
    }

    #[tracing::instrument(name = "gitai.dynamodb.cache_commit_link", skip_all, fields(sha = %link.sha), err)]
    async fn cache_commit_link(&self, link: &CommitPullRequestLink) -> Result<(), Self::Err> {
        let mut item = key(commit_link_pk(&link.sha), COMMIT_LINK_SK);
        if let Some(number) = link.pr_number {
            item.insert(
                "pr_number".to_owned(),
                AttributeValue::N(number.to_string()),
            );
        }
        item.insert(
            EXPIRES_AT.to_owned(),
            AttributeValue::N(link.expires_at.timestamp().to_string()),
        );
        self.client
            .put_item()
            .table_name(&self.table)
            .set_item(Some(item))
            .send()
            .await?;
        Ok(())
    }
}
