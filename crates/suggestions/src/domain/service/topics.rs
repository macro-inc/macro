//! Naming topics and giving suggestions theirs.

use super::*;
use crate::domain::model::Target;
use crate::domain::topic::{StoredTopic, Topic, TopicChange, topic_keys, topics_of};

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
        if let Some(reason) = &topic.reason {
            self.inaccessible(
                &session.user,
                std::slice::from_ref(&reason.source),
                &mut problems,
            )
            .await?;
        }
        if !problems.is_empty() {
            return Ok(rejected(&span, problems));
        }
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

    /// The topics of `suggestions`, each with its reason while the reason
    /// holds and the person can open the item it was read in. They can open
    /// what the suggestions `viewable` are about, so that isn't checked again.
    pub(super) async fn topics(
        &self,
        user: &MacroUserIdStr<'_>,
        suggestions: &[Suggestion],
        viewable: &[Suggestion],
    ) -> Result<Vec<Topic>, SuggestionError> {
        let mut stored = self.stored_topics(user, topic_keys(suggestions)).await?;
        let viewable: HashSet<(EntityType, &str)> = viewable
            .iter()
            .flat_map(|suggestion| &suggestion.about)
            .map(|target| (target.entity_type, target.entity_id.as_str()))
            .collect();
        let viewable = &viewable;
        futures::stream::iter(&mut stored)
            .for_each_concurrent(ACCESS_CHECKS_AT_ONCE, |topic| async move {
                let Some(reason) = &topic.reason else {
                    return;
                };
                let source = &reason.source;
                let shown = !topic.settled_since_named()
                    && (viewable.contains(&(source.entity_type, source.entity_id.as_str()))
                        || self.can_open(user, source).await);
                if !shown {
                    topic.reason = None;
                }
            })
            .await;
        Ok(topics_of(suggestions, &stored))
    }

    /// Whether the person can open the item a topic's reason was read in; one
    /// that can't be checked is logged and counts as closed.
    async fn can_open(&self, user: &MacroUserIdStr<'_>, source: &Target) -> bool {
        match self.access.can_view(user, source).await {
            Ok(viewable) => viewable,
            Err(error) => {
                tracing::warn!(
                    ?error,
                    "could not check a topic's source; its reason is left out"
                );
                false
            }
        }
    }

    /// The person's topics `keys`, as stored.
    async fn stored_topics(
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

    /// The key of the topic `suggestion`, or a new one, has after `change`.
    pub(super) async fn topic_after(
        &self,
        user: &MacroUserIdStr<'_>,
        suggestion: Option<&Suggestion>,
        change: TopicChange,
        problems: &mut Vec<String>,
    ) -> Result<Option<String>, SuggestionError> {
        match change {
            TopicChange::Keep => Ok(suggestion
                .and_then(|suggestion| suggestion.topic.as_ref())
                .map(|topic| topic.key.clone())),
            TopicChange::Clear => Ok(None),
            TopicChange::To(key) => self.named_topic(user, &key, problems).await,
        }
    }

    /// The topic `key` a session gives a suggestion, when it has named it.
    async fn named_topic(
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
