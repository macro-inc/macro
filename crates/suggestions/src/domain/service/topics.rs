//! Naming topics and giving suggestions theirs.

use super::*;
use crate::domain::topic::StoredTopic;

/// Most topics one generation may name: more than the open suggestions could
/// share, two or more to each.
pub const TOPICS_PER_GENERATION: u32 = 15;

impl<Repo, Access, Drafts, Flags> SuggestionService<Repo, Access, Drafts, Flags>
where
    Repo: SuggestionRepo,
    Access: SuggestionAccess,
    Drafts: SuggestionDrafts,
    Flags: FeatureFlags + 'static,
{
    /// Name a topic, or rename the one with its key, as a session.
    pub(super) async fn name(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        request: NameTopic,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let mut problems = Vec::new();
        let Some(topic) = check::topic(request, &mut problems) else {
            return Ok(rejected(&span, problems));
        };
        let named = self
            .repo
            .name_topic(&session, &topic, TOPICS_PER_GENERATION, Utc::now())
            .await
            .map_err(SuggestionError::internal)?;
        if !named {
            return Ok(rejected(
                &span,
                vec![format!(
                    "this generation named {TOPICS_PER_GENERATION} topics, the most for one run; \
                     use those"
                )],
            ));
        }
        span.record("suggestion.outcome", "named");
        Ok(SuggestionWriteOutcome {
            ok: true,
            problems: Vec::new(),
            suggestion: None,
        })
    }

    /// The person's topics `keys`, as stored.
    pub(super) async fn stored_topics(
        &self,
        user: &MacroUserIdStr<'_>,
        keys: HashSet<String>,
    ) -> Result<Vec<StoredTopic>, SuggestionError> {
        if keys.is_empty() {
            return Ok(Vec::new());
        }
        let keys: Vec<String> = keys.into_iter().collect();
        self.repo
            .topics(user, &keys)
            .await
            .map_err(SuggestionError::internal)
    }

    /// The topic `key` a session gives a suggestion, when it has named it.
    pub(super) async fn named_topic(
        &self,
        user: &MacroUserIdStr<'_>,
        key: &str,
        problems: &mut Vec<String>,
    ) -> Result<Option<String>, SuggestionError> {
        let Some(key) = check::topic_key(key, problems) else {
            return Ok(None);
        };
        let stored = self
            .stored_topics(user, HashSet::from([key.clone()]))
            .await?;
        if stored.is_empty() {
            problems.push(format!(
                "there is no topic `{key}`; name it first with `macro.suggestions.nameTopic`"
            ));
        }
        Ok(Some(key))
    }
}
