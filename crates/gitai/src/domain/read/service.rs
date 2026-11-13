//! The read API's use cases: attribution of a commit or pull request, blame,
//! and sessions with their transcripts.
//!
//! Squash merges: `main` is squash-merged, so its commits carry no note. A
//! commit without an indexed note is looked up on GitHub; the `(#N)` at the
//! end of its subject names the pull request, whose commits are listed and
//! joined to the indexed notes. GitHub's answers are cached in the index: a
//! commit's link for 30 days (a subject never changes), an open pull
//! request's commits for 5 minutes (it can still grow), a closed one's for
//! 30 days. Notes are joined on every read, so a note uploaded later shows up
//! at once.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Read as _;
use std::sync::Arc;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{Duration, Utc};
use futures::future::try_join_all;
use lazy_regex::regex_captures;
use serde_json::Value;
use tracing::field::Empty;
use upstream_error::UpstreamError;

use super::attestation::Attestations;
use super::models::{
    Attribution, Blame, BlameQuery, BlameRange, CachedPullRequest, CommitPullRequestLink,
    CommitSession, CommitSha, EventsCursor, EventsPage, PullRequestRef, REPOSITORY, ResolvedVia,
    SessionEntry, SessionId, SessionSummary, StoredCommit, StoredSession, Tokens,
    TranscriptChunk, from_unix_seconds, micro_usd_to_usd,
};
use super::ports::{DeviceAuthenticator, GithubApi, GithubError, ReadIndex};
use crate::domain::models::GitaiError;
use crate::domain::ports::{Bucket, ObjectStore};

#[cfg(test)]
mod test;

/// How long a commit's pull request link is cached.
const COMMIT_LINK_TTL: Duration = Duration::days(30);
/// How long an open pull request's commits are cached.
const OPEN_PULL_REQUEST_TTL: Duration = Duration::minutes(5);
/// How long a closed or merged pull request's commits are cached.
const CLOSED_PULL_REQUEST_TTL: Duration = Duration::days(30);

/// Revision blamed when none is given.
const DEFAULT_BLAME_REV: &str = "main";
/// Most lines one blame request may cover.
const MAX_BLAME_LINES: u32 = 5_000;
/// Most distinct commits one blame request resolves; ranges of further
/// commits come back without a session, to bound GitHub calls.
const MAX_BLAME_COMMITS: usize = 50;

/// Transcript lines per page when the caller does not say.
const DEFAULT_EVENTS_LIMIT: usize = 100;
/// Most transcript lines per page.
pub const MAX_EVENTS_LIMIT: usize = 500;

/// Why a read failed.
#[derive(Debug, thiserror::Error)]
pub enum ReadError {
    /// Authentication, lookup or validation failed.
    #[error(transparent)]
    Gitai(#[from] GitaiError),
    /// GitHub failed.
    #[error(transparent)]
    Github(#[from] UpstreamError),
    /// Blame needs a GitHub token and none is configured.
    #[error("blame needs a GitHub token")]
    BlameNeedsToken,
}

impl From<GithubError> for ReadError {
    fn from(error: GithubError) -> Self {
        match error {
            GithubError::Upstream(upstream) => Self::Github(upstream),
            GithubError::BlameNeedsToken => Self::BlameNeedsToken,
        }
    }
}

fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> ReadError {
    ReadError::Gitai(GitaiError::Internal(
        rootcause::Report::new(error).into_dynamic(),
    ))
}

fn not_found() -> ReadError {
    ReadError::Gitai(GitaiError::NotFound)
}

fn bad_request(message: &str) -> ReadError {
    ReadError::Gitai(GitaiError::BadRequest(message.to_owned()))
}

/// The pull request a squash-merge subject names: `(#N)` at its end.
pub fn pull_request_in_subject(subject: &str) -> Option<u64> {
    let (_, number) = regex_captures!(r"\(#([0-9]+)\)\s*$", subject)?;
    number.parse().ok()
}

/// The commits behind an attribution, and how they were found.
struct Resolution {
    sha: Option<String>,
    pr: Option<u64>,
    via: ResolvedVia,
    commits: Vec<String>,
    stored: Vec<StoredCommit>,
}

impl Resolution {
    fn note(stored: StoredCommit) -> Self {
        Self {
            sha: Some(stored.sha.clone()),
            pr: None,
            via: ResolvedVia::Note,
            commits: vec![stored.sha.clone()],
            stored: vec![stored],
        }
    }
}

/// The read use cases. Each authenticates its caller's device credential.
pub struct ReadService<Auth, Objects, Index, Github> {
    auth: Arc<Auth>,
    objects: Objects,
    index: Index,
    github: Github,
}

impl<Auth: DeviceAuthenticator, Objects: ObjectStore, Index: ReadIndex, Github: GithubApi>
    ReadService<Auth, Objects, Index, Github>
{
    /// A service over the given adapters; `auth` checks device credentials.
    pub fn new(auth: Arc<Auth>, objects: Objects, index: Index, github: Github) -> Self {
        Self {
            auth,
            objects,
            index,
            github,
        }
    }

    /// `GET /v1/commits/{sha}`: from the commit's note, or through the pull
    /// request its subject names.
    #[tracing::instrument(name = "gitai.read.commit", skip(self, presented), fields(resolved_via = Empty, pr = Empty), err)]
    pub async fn commit(
        &self,
        presented: Option<&str>,
        sha: &str,
    ) -> Result<Attribution, ReadError> {
        self.auth.authenticate_device(presented).await?;
        let sha = CommitSha::parse(sha)?;
        let resolution = self.resolve_commit(&sha).await?.ok_or_else(not_found)?;
        let span = tracing::Span::current();
        span.record("resolved_via", tracing::field::debug(resolution.via));
        if let Some(pr) = resolution.pr {
            span.record("pr", pr);
        }
        self.attribution(resolution).await
    }

    /// `GET /v1/prs/macro-inc/macro/{n}`.
    #[tracing::instrument(name = "gitai.read.pull_request", skip(self, presented), fields(commits = Empty), err)]
    pub async fn pull_request(
        &self,
        presented: Option<&str>,
        number: u64,
    ) -> Result<Attribution, ReadError> {
        self.auth.authenticate_device(presented).await?;
        let commits = self
            .pull_request_commits(number)
            .await?
            .ok_or_else(not_found)?;
        tracing::Span::current().record("commits", commits.len());
        let stored = self.stored_commits(&commits).await?;
        self.attribution(Resolution {
            sha: None,
            pr: Some(number),
            via: ResolvedVia::Pr,
            commits,
            stored,
        })
        .await
    }

    /// `GET /v1/sessions/{id}`.
    #[tracing::instrument(name = "gitai.read.session", skip(self, presented), err)]
    pub async fn session(
        &self,
        presented: Option<&str>,
        id: &str,
    ) -> Result<SessionEntry, ReadError> {
        self.auth.authenticate_device(presented).await?;
        let id = SessionId::parse(id)?;
        let session = self.stored_session(&id).await?.ok_or_else(not_found)?;
        Ok(session.into())
    }

    /// `GET /v1/sessions/{id}/events`: transcript lines oldest first, from
    /// the cursor `from`, at most `limit` (default 100, capped at 500).
    #[tracing::instrument(name = "gitai.read.session_events", skip(self, presented, from), fields(events = Empty), err)]
    pub async fn session_events(
        &self,
        presented: Option<&str>,
        id: &str,
        from: Option<&str>,
        limit: Option<usize>,
    ) -> Result<EventsPage, ReadError> {
        self.auth.authenticate_device(presented).await?;
        let id = SessionId::parse(id)?;
        let limit = limit.unwrap_or(DEFAULT_EVENTS_LIMIT).min(MAX_EVENTS_LIMIT);
        if limit == 0 {
            return Err(bad_request("limit must be at least 1"));
        }
        let cursor = from.map(decode_cursor).transpose()?;
        if self.stored_session(&id).await?.is_none() {
            return Err(not_found());
        }

        let chunks = self
            .index
            .transcript_chunks(id.as_str(), cursor.as_ref().map(|c| c.chunk.as_str()))
            .await
            .map_err(internal)?;
        let mut skip = cursor.map_or(0, |cursor| cursor.offset);
        let mut events = Vec::new();
        let mut next = None;

        // Fill the page chunk by chunk. When the page fills inside a chunk,
        // the cursor points at the rest of that chunk; when it fills at a
        // chunk's end, at the start of the next chunk, if there is one.
        for (position, chunk) in chunks.iter().enumerate() {
            let lines = self.transcript_lines(chunk).await?;
            let remaining = lines.get(skip..).unwrap_or_default();
            let room = limit - events.len();

            if remaining.len() > room {
                events.extend_from_slice(remaining.get(..room).unwrap_or_default());
                next = Some(EventsCursor {
                    chunk: chunk.sort_key.clone(),
                    offset: skip + room,
                });
                break;
            }

            events.extend_from_slice(remaining);
            skip = 0;
            if events.len() == limit {
                next = chunks.get(position + 1).map(|following| EventsCursor {
                    chunk: following.sort_key.clone(),
                    offset: 0,
                });
                break;
            }
        }

        tracing::Span::current().record("events", events.len());
        Ok(EventsPage {
            events,
            next: next.map(|cursor| encode_cursor(&cursor)).transpose()?,
        })
    }

    /// `GET /v1/blame`. GitHub's blame maps the lines to the commits that
    /// last changed them; each commit resolves like `GET /v1/commits`.
    ///
    /// Note line numbers count in the noted commit's version of the file,
    /// and GitHub does not say where a blamed line sat in that version. So
    /// a range gets its session line by line only when the blamed commit is
    /// the revision itself and has its own note. Otherwise a range gets the
    /// session when one session alone wrote lines of the file in that commit
    /// (or its pull request), and `session_ids` lists them when several did.
    #[tracing::instrument(name = "gitai.read.blame", skip_all, fields(start = query.start, end = query.end, commits = Empty), err)]
    pub async fn blame(
        &self,
        presented: Option<&str>,
        query: BlameQuery,
    ) -> Result<Blame, ReadError> {
        self.auth.authenticate_device(presented).await?;
        if query.path.is_empty() || query.start == 0 || query.end < query.start {
            return Err(bad_request("path, start and end must name lines of a file"));
        }
        if query.end - query.start >= MAX_BLAME_LINES {
            return Err(bad_request("at most 5000 lines per blame"));
        }
        let rev = query.rev.unwrap_or_else(|| DEFAULT_BLAME_REV.to_owned());
        let blame = self
            .github
            .blame(&rev, &query.path)
            .await?
            .ok_or_else(not_found)?;

        let hunks: Vec<_> = blame
            .hunks
            .into_iter()
            .filter(|hunk| hunk.end >= query.start && hunk.start <= query.end)
            .map(|mut hunk| {
                hunk.start = hunk.start.max(query.start);
                hunk.end = hunk.end.min(query.end);
                hunk
            })
            .collect();

        // Resolve each distinct commit once, up to the cap.
        let mut sources: HashMap<String, (bool, Vec<Attestations>)> = HashMap::new();
        for hunk in &hunks {
            if sources.contains_key(&hunk.commit) || sources.len() >= MAX_BLAME_COMMITS {
                continue;
            }
            let sha = CommitSha::parse(&hunk.commit)?;
            let source = match self.resolve_commit(&sha).await? {
                Some(resolution) => {
                    let exact =
                        resolution.via == ResolvedVia::Note && hunk.commit == blame.commit;
                    let notes = self.attestations(&resolution.stored).await?;
                    (exact, notes.into_iter().flatten().collect())
                }
                None => (false, Vec::new()),
            };
            sources.insert(hunk.commit.clone(), source);
        }
        tracing::Span::current().record("commits", sources.len());

        let mut ranges = Vec::new();
        for hunk in hunks {
            let Some((exact, notes)) = sources.get(&hunk.commit) else {
                ranges.push(blame_range(hunk.start, hunk.end, &hunk.commit, None, Vec::new()));
                continue;
            };
            if *exact {
                ranges.extend(exact_ranges(&query.path, &hunk.commit, hunk.start, hunk.end, notes));
                continue;
            }

            let mut lines_per_session: BTreeMap<&str, usize> = BTreeMap::new();
            for note in notes {
                for (session, lines) in note.sessions_in_file(&query.path) {
                    *lines_per_session.entry(session).or_default() += lines;
                }
            }
            let mut sessions: Vec<(&str, usize)> = lines_per_session.into_iter().collect();
            sessions.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));

            let range = match sessions.as_slice() {
                [(only, _)] => blame_range(
                    hunk.start,
                    hunk.end,
                    &hunk.commit,
                    Some((*only).to_owned()),
                    Vec::new(),
                ),
                many => blame_range(
                    hunk.start,
                    hunk.end,
                    &hunk.commit,
                    None,
                    many.iter().map(|(id, _)| (*id).to_owned()).collect(),
                ),
            };
            ranges.push(range);
        }

        let ids: Vec<String> = ranges
            .iter()
            .filter_map(|range| range.session_id.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let sessions = self.stored_sessions(&ids).await?;
        for range in &mut ranges {
            let Some(session) = range.session_id.as_ref().and_then(|id| sessions.get(id)) else {
                continue;
            };
            range.tool = session.tool.clone();
            range.model = session.model.clone();
            range.author = session.author.clone();
        }

        Ok(Blame {
            path: query.path,
            rev,
            ranges,
        })
    }

    /// The commits behind `sha`: its own note, or its pull request's notes.
    /// `None` when neither is known.
    async fn resolve_commit(&self, sha: &CommitSha) -> Result<Option<Resolution>, ReadError> {
        if sha.is_full()
            && let Some(stored) = self.stored_commit(sha.as_str()).await?
        {
            return Ok(Some(Resolution::note(stored)));
        }

        let Some(link) = self.commit_link(sha).await? else {
            return Ok(None);
        };
        // An abbreviated SHA is only stored under its full form.
        if link.sha != sha.as_str()
            && let Some(stored) = self.stored_commit(&link.sha).await?
        {
            return Ok(Some(Resolution::note(stored)));
        }

        let Some(number) = link.pr_number else {
            return Ok(None);
        };
        let Some(commits) = self.pull_request_commits(number).await? else {
            return Ok(None);
        };
        let stored = self.stored_commits(&commits).await?;
        Ok(Some(Resolution {
            sha: Some(link.sha),
            pr: Some(number),
            via: ResolvedVia::Pr,
            commits,
            stored,
        }))
    }

    /// Which pull request a commit's subject names, from the cache or
    /// GitHub. `None` when GitHub does not know the commit.
    async fn commit_link(
        &self,
        sha: &CommitSha,
    ) -> Result<Option<CommitPullRequestLink>, ReadError> {
        let now = Utc::now();
        if sha.is_full() {
            let cached = self
                .index
                .cached_commit_link(sha.as_str())
                .await
                .map_err(internal)?;
            if let Some(link) = cached.filter(|link| link.expires_at > now) {
                return Ok(Some(link));
            }
        }

        let Some(commit) = self.github.commit(sha.as_str()).await? else {
            return Ok(None);
        };
        let link = CommitPullRequestLink {
            pr_number: pull_request_in_subject(&commit.subject),
            sha: commit.sha,
            expires_at: now + COMMIT_LINK_TTL,
        };
        // A failed cache write costs a GitHub call next time, nothing more.
        let _ = self.index.cache_commit_link(&link).await.inspect_err(
            |error| tracing::warn!(error = ?error, "could not cache a commit's pull request"),
        );
        Ok(Some(link))
    }

    /// A pull request's commits, from the cache or GitHub. `None` when
    /// GitHub does not know the pull request.
    async fn pull_request_commits(&self, number: u64) -> Result<Option<Vec<String>>, ReadError> {
        let now = Utc::now();
        let cached = self
            .index
            .cached_pull_request(number)
            .await
            .map_err(internal)?;
        if let Some(cached) = cached.filter(|cached| cached.expires_at > now) {
            return Ok(Some(cached.commits));
        }

        let Some(pull_request) = self.github.pull_request(number).await? else {
            return Ok(None);
        };
        let commits = self.github.pull_request_commits(number).await?;
        let ttl = if pull_request.open {
            OPEN_PULL_REQUEST_TTL
        } else {
            CLOSED_PULL_REQUEST_TTL
        };
        let cached = CachedPullRequest {
            number,
            commits,
            open: pull_request.open,
            expires_at: now + ttl,
        };
        let _ = self.index.cache_pull_request(&cached).await.inspect_err(
            |error| tracing::warn!(error = ?error, "could not cache a pull request's commits"),
        );
        Ok(Some(cached.commits))
    }

    async fn stored_commit(&self, sha: &str) -> Result<Option<StoredCommit>, ReadError> {
        let mut commits = self.stored_commits(&[sha.to_owned()]).await?;
        Ok(commits.pop())
    }

    async fn stored_commits(&self, shas: &[String]) -> Result<Vec<StoredCommit>, ReadError> {
        self.index.commits(shas).await.map_err(internal)
    }

    async fn stored_session(&self, id: &SessionId) -> Result<Option<StoredSession>, ReadError> {
        let mut sessions = self.stored_sessions(&[id.as_str().to_owned()]).await?;
        Ok(sessions.remove(id.as_str()))
    }

    async fn stored_sessions(
        &self,
        ids: &[String],
    ) -> Result<HashMap<String, StoredSession>, ReadError> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let sessions = self.index.sessions(ids).await.map_err(internal)?;
        Ok(sessions
            .into_iter()
            .map(|session| (session.id.clone(), session))
            .collect())
    }

    /// Each commit's note attestations, in order; `None` where the note is
    /// not stored or is not text.
    async fn attestations(
        &self,
        commits: &[StoredCommit],
    ) -> Result<Vec<Option<Attestations>>, ReadError> {
        let reads = commits.iter().map(|commit| async move {
            let Some(key) = &commit.note_key else {
                return Ok(None);
            };
            let body = self
                .objects
                .get(Bucket::Events, key)
                .await
                .map_err(internal)?;
            let note = body.and_then(|bytes| String::from_utf8(bytes).ok());
            Ok::<_, ReadError>(note.map(|note| Attestations::parse(&note)))
        });
        try_join_all(reads).await
    }

    /// The transcript lines of one chunk (`event.v["0"]` of each stored
    /// line), oldest first. Empty when the object has expired.
    async fn transcript_lines(&self, chunk: &TranscriptChunk) -> Result<Vec<Value>, ReadError> {
        let Some(compressed) = self
            .objects
            .get(Bucket::Sessions, &chunk.s3_key)
            .await
            .map_err(internal)?
        else {
            return Ok(Vec::new());
        };

        let mut text = String::new();
        ruzstd::decoding::StreamingDecoder::new(compressed.as_slice())
            .map_err(internal)?
            .read_to_string(&mut text)
            .map_err(internal)?;

        let mut lines = Vec::new();
        for line in text.lines() {
            let mut stored: Value = serde_json::from_str(line).map_err(internal)?;
            if let Some(transcript_line) = stored.pointer_mut("/event/v/0") {
                lines.push(transcript_line.take());
            }
        }
        Ok(lines)
    }

    /// Totals and per-session parts of the resolved commits.
    async fn attribution(&self, resolution: Resolution) -> Result<Attribution, ReadError> {
        let notes = self.attestations(&resolution.stored).await?;

        let mut ai_lines = 0;
        let mut human_lines = 0;
        let mut session_lines: BTreeMap<String, u64> = BTreeMap::new();
        let mut from_notes: HashMap<String, (CommitSession, Option<String>)> = HashMap::new();

        // Per-session lines come from the note's attestations. A commit
        // whose note text is missing gives its AI lines to its session when
        // it names only one.
        for (commit, note) in resolution.stored.iter().zip(&notes) {
            ai_lines += commit.ai_lines;
            human_lines += commit.human_lines;

            for session in &commit.sessions {
                session_lines.entry(session.session_id.clone()).or_default();
                from_notes
                    .entry(session.session_id.clone())
                    .or_insert_with(|| (session.clone(), commit.author.clone()));
            }

            match (note, commit.sessions.as_slice()) {
                (Some(note), _) => {
                    for (session, lines) in note.lines_per_session() {
                        *session_lines.entry(session.to_owned()).or_default() += lines;
                    }
                }
                (None, [only]) => {
                    *session_lines.entry(only.session_id.clone()).or_default() += commit.ai_lines;
                }
                (None, _) => {}
            }
        }

        let ids: Vec<String> = session_lines.keys().cloned().collect();
        let mut stored_sessions = self.stored_sessions(&ids).await?;

        let mut tokens = Tokens::default();
        let mut cost_micro_usd = 0;
        let mut sessions = Vec::with_capacity(session_lines.len());
        for (id, lines) in session_lines {
            let stored = stored_sessions.remove(&id).unwrap_or_default();
            let (noted, committer) = match from_notes.remove(&id) {
                Some((session, author)) => (Some(session), author),
                None => (None, None),
            };
            tokens += stored.tokens;
            cost_micro_usd += stored.cost_micro_usd;

            let (url, events_url) = SessionSummary::urls(&id);
            sessions.push(SessionSummary {
                tool: stored
                    .tool
                    .or_else(|| noted.as_ref().and_then(|s| s.tool.clone())),
                model: stored
                    .model
                    .or_else(|| noted.as_ref().and_then(|s| s.model.clone())),
                author: stored.author.or(committer),
                first_seen: stored.first_seen.and_then(from_unix_seconds),
                last_seen: stored.last_seen.and_then(from_unix_seconds),
                ai_lines: lines,
                tokens: stored.tokens,
                cost_usd: micro_usd_to_usd(stored.cost_micro_usd),
                id,
                url,
                events_url,
            });
        }
        sessions.sort_by(|a, b| b.ai_lines.cmp(&a.ai_lines).then(a.id.cmp(&b.id)));

        let attributed: HashSet<&str> = resolution
            .stored
            .iter()
            .map(|commit| commit.sha.as_str())
            .collect();
        let unattributed_commits = resolution
            .commits
            .iter()
            .filter(|sha| !attributed.contains(sha.as_str()))
            .cloned()
            .collect();

        let added = ai_lines + human_lines;
        // Line counts stay far below 2^53, so the ratio is exact enough.
        let ai_share = (added > 0).then(|| ai_lines as f64 / added as f64);

        Ok(Attribution {
            repo: REPOSITORY,
            sha: resolution.sha,
            pr: resolution.pr.map(PullRequestRef::new),
            resolved_via: resolution.via,
            commits: resolution.commits,
            unattributed_commits,
            ai_lines,
            human_lines,
            ai_share,
            tokens,
            cost_usd: micro_usd_to_usd(cost_micro_usd),
            sessions,
        })
    }
}

fn blame_range(
    start: u32,
    end: u32,
    commit: &str,
    session_id: Option<String>,
    session_ids: Vec<String>,
) -> BlameRange {
    BlameRange {
        start,
        end,
        commit: commit.to_owned(),
        session_id,
        tool: None,
        model: None,
        author: None,
        session_ids,
    }
}

/// Splits `start..=end` into runs of lines with the same session, from the
/// commit's own note.
fn exact_ranges(
    path: &str,
    commit: &str,
    start: u32,
    end: u32,
    notes: &[Attestations],
) -> Vec<BlameRange> {
    let session_at = |line| {
        notes
            .iter()
            .find_map(|note| note.session_at(path, line))
            .map(str::to_owned)
    };

    let mut ranges: Vec<BlameRange> = Vec::new();
    for line in start..=end {
        let session = session_at(line);
        match ranges.last_mut() {
            Some(last) if last.session_id == session => last.end = line,
            _ => ranges.push(blame_range(line, line, commit, session, Vec::new())),
        }
    }
    ranges
}

fn encode_cursor(cursor: &EventsCursor) -> Result<String, ReadError> {
    let json = serde_json::to_vec(cursor).map_err(internal)?;
    Ok(URL_SAFE_NO_PAD.encode(json))
}

fn decode_cursor(raw: &str) -> Result<EventsCursor, ReadError> {
    URL_SAFE_NO_PAD
        .decode(raw)
        .ok()
        .and_then(|json| serde_json::from_slice(&json).ok())
        .ok_or_else(|| bad_request("from is not a cursor this server issued"))
}
