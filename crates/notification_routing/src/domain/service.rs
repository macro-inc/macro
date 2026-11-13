//! The stack service: a person managing their own stacks.

#[cfg(test)]
mod test;

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::NotificationLane;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::models::{
    InvalidStack, MAX_CONDITION_VALUES, MAX_RULES, MAX_STACKS, MAX_TEXT_LENGTH,
    NOTIFICATION_STACKS_FLAG, NewStack, NotificationStack, StackChanges, StackError, StackRule,
    StackSource,
};
use crate::domain::ports::{NotificationStackService, StackRepository};

/// Concrete stack service backed by a [`StackRepository`] and gated by a
/// feature flag.
#[derive(Debug, Clone)]
pub struct NotificationStackServiceImpl<R, F> {
    repo: R,
    flags: F,
}

impl<R, F> NotificationStackServiceImpl<R, F>
where
    R: StackRepository,
    F: FeatureFlags + 'static,
{
    /// Create a stack service over `repo`, open to the people `flags` turns
    /// stacks on for.
    pub fn new(repo: R, flags: F) -> Self {
        Self { repo, flags }
    }

    /// Refuse someone stacks are not turned on for. A flag that cannot be
    /// read is an error, not an answer.
    async fn require_available(&self, owner: &MacroUserIdStr<'_>) -> Result<(), StackError> {
        let flags = self.flags.load(owner).await?;
        if flags.is_enabled(NOTIFICATION_STACKS_FLAG) {
            Ok(())
        } else {
            Err(StackError::Unavailable)
        }
    }
}

impl<R, F> NotificationStackService for NotificationStackServiceImpl<R, F>
where
    R: StackRepository,
    F: FeatureFlags + 'static,
{
    #[tracing::instrument(name = "notification_stack.list", skip_all, err)]
    async fn list(&self, owner: &MacroUserIdStr<'_>) -> Result<Vec<NotificationStack>, StackError> {
        self.require_available(owner).await?;

        self.repo.list(owner).await.map_err(internal)
    }

    #[tracing::instrument(
        name = "notification_stack.create",
        skip_all,
        fields(stack_id = tracing::field::Empty),
        err
    )]
    async fn create(
        &self,
        owner: &MacroUserIdStr<'_>,
        stack: NewStack,
    ) -> Result<NotificationStack, StackError> {
        self.require_available(owner).await?;

        let stack = NewStack {
            name: valid_name(&stack.name)?,
            capture: valid_capture_rules(stack.capture)?,
            release: valid_rules(stack.release)?,
        };
        let id = Uuid::now_v7();
        tracing::Span::current().record("stack_id", tracing::field::display(id));

        // Stacks capture into noise only for now.
        self.repo
            .create(owner, id, &stack, NotificationLane::Noise, MAX_STACKS)
            .await
            .map_err(internal)?
            .ok_or(StackError::Invalid(InvalidStack::TooManyStacks))
    }

    #[tracing::instrument(name = "notification_stack.update", skip_all, fields(stack_id = %id), err)]
    async fn update(
        &self,
        owner: &MacroUserIdStr<'_>,
        id: Uuid,
        changes: StackChanges,
    ) -> Result<NotificationStack, StackError> {
        self.require_available(owner).await?;

        let changes = StackChanges {
            name: changes.name.as_deref().map(valid_name).transpose()?,
            capture: changes.capture.map(valid_capture_rules).transpose()?,
            release: changes.release.map(valid_rules).transpose()?,
            enabled: changes.enabled,
        };

        self.repo
            .update(owner, id, &changes)
            .await
            .map_err(internal)?
            .ok_or(StackError::NotFound)
    }

    #[tracing::instrument(name = "notification_stack.delete", skip_all, fields(stack_id = %id), err)]
    async fn delete(&self, owner: &MacroUserIdStr<'_>, id: Uuid) -> Result<(), StackError> {
        self.require_available(owner).await?;

        if self.repo.delete(owner, id).await.map_err(internal)? {
            Ok(())
        } else {
            Err(StackError::NotFound)
        }
    }

    #[tracing::instrument(
        name = "notification_stack.reorder",
        skip_all,
        fields(stacks = ids.len()),
        err
    )]
    async fn reorder(
        &self,
        owner: &MacroUserIdStr<'_>,
        ids: Vec<Uuid>,
    ) -> Result<Vec<NotificationStack>, StackError> {
        self.require_available(owner).await?;

        self.repo
            .reorder(owner, &ids)
            .await
            .map_err(internal)?
            .ok_or(StackError::Invalid(InvalidStack::OrderMismatch))
    }
}

fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> StackError {
    StackError::Internal(Report::new(error).into_dynamic())
}

fn valid_name(name: &str) -> Result<String, InvalidStack> {
    let name = name.trim();
    if name.is_empty() {
        return Err(InvalidStack::NameMissing);
    }

    valid_length(name)?;
    Ok(name.to_string())
}

fn valid_length(text: &str) -> Result<(), InvalidStack> {
    if text.chars().count() > MAX_TEXT_LENGTH {
        return Err(InvalidStack::TextTooLong);
    }

    Ok(())
}

fn valid_capture_rules(rules: Vec<StackRule>) -> Result<Vec<StackRule>, InvalidStack> {
    if rules.is_empty() {
        return Err(InvalidStack::NoCaptureRule);
    }

    valid_rules(rules)
}

fn valid_rules(rules: Vec<StackRule>) -> Result<Vec<StackRule>, InvalidStack> {
    if rules.len() > MAX_RULES {
        return Err(InvalidStack::TooManyRules);
    }

    rules.into_iter().map(valid_rule).collect()
}

fn valid_rule(rule: StackRule) -> Result<StackRule, InvalidStack> {
    if !rule.sets_a_condition() {
        return Err(InvalidStack::RuleWithoutCondition);
    }

    let longest_condition = rule
        .sources
        .len()
        .max(rule.channel_types.len())
        .max(rule.kinds.len())
        .max(rule.senders.len());
    if longest_condition > MAX_CONDITION_VALUES {
        return Err(InvalidStack::TooManyValues);
    }

    Ok(StackRule {
        sources: rule
            .sources
            .into_iter()
            .map(valid_source)
            .collect::<Result<_, _>>()?,
        ..rule
    })
}

/// A source with its text trimmed. Channel name text is matched as written,
/// so stray spaces around it would never match.
fn valid_source(source: StackSource) -> Result<StackSource, InvalidStack> {
    let trimmed = |text: String| {
        let text = text.trim();
        if text.is_empty() {
            return Err(InvalidStack::SourceEmpty);
        }

        valid_length(text)?;
        Ok(text.to_string())
    };

    Ok(match source {
        StackSource::Channel { id } => StackSource::Channel { id: trimmed(id)? },
        StackSource::ChannelNameContains { text } => StackSource::ChannelNameContains {
            text: trimmed(text)?,
        },
        StackSource::Document { id } => StackSource::Document { id: trimmed(id)? },
        StackSource::Folder { id } => StackSource::Folder { id: trimmed(id)? },
        StackSource::Project { id } => StackSource::Project { id: trimmed(id)? },
    })
}
