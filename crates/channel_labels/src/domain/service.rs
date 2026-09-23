//! Channel labels service implementation.

#[cfg(test)]
mod test;

use uuid::Uuid;

use crate::domain::models::{
    ChannelLabel, ChannelLabelRule, ChannelLabelsError, ChannelLabelsReceipt, LabelWriteOutcome,
    MAX_LABEL_NAME_LEN, MAX_SMART_TAG_PATTERN_LEN, NewChannelLabel, SetChannelLabelOutcome,
    SmartTagPreview,
};
use crate::domain::ports::{ChannelLabelsRepo, ChannelLabelsService};

/// Concrete channel labels service backed by a [`ChannelLabelsRepo`].
#[derive(Debug, Clone)]
pub struct ChannelLabelsServiceImpl<R> {
    repo: R,
}

impl<R> ChannelLabelsServiceImpl<R>
where
    R: ChannelLabelsRepo,
    anyhow::Error: From<R::Err>,
{
    /// Create a service backed by the provided repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }

    async fn apply_channel_label(
        &self,
        receipt: &ChannelLabelsReceipt,
        channel_id: Uuid,
        label_id: Option<Uuid>,
    ) -> Result<(), ChannelLabelsError> {
        let outcome = self
            .repo
            .set_channel_label(receipt.scope(), channel_id, label_id, receipt.user_id())
            .await
            .map_err(anyhow::Error::from)?;
        channel_write_result(outcome)
    }
}

fn channel_write_result(outcome: SetChannelLabelOutcome) -> Result<(), ChannelLabelsError> {
    match outcome {
        SetChannelLabelOutcome::Updated => Ok(()),
        SetChannelLabelOutcome::ChannelNotFound => {
            Err(ChannelLabelsError::NotFound("channel not found"))
        }
        SetChannelLabelOutcome::LabelNotFound => {
            Err(ChannelLabelsError::NotFound("label not found"))
        }
        SetChannelLabelOutcome::ChannelNotLabelable => Err(ChannelLabelsError::BadRequest(
            "only team channels in this label's scope can be added to a label".to_string(),
        )),
        SetChannelLabelOutcome::SmartTagReadOnly => Err(ChannelLabelsError::BadRequest(
            "smart tag membership is determined by its rule".to_string(),
        )),
    }
}

/// Normalise a requested label name, rejecting blank or oversized input.
fn validate_name(name: &str) -> Result<String, ChannelLabelsError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ChannelLabelsError::BadRequest(
            "label name must not be empty".to_string(),
        ));
    }
    if trimmed.chars().count() > MAX_LABEL_NAME_LEN {
        return Err(ChannelLabelsError::BadRequest(format!(
            "label name must be at most {MAX_LABEL_NAME_LEN} characters"
        )));
    }
    Ok(trimmed.to_string())
}

fn validate_rule(rule: ChannelLabelRule) -> Result<ChannelLabelRule, ChannelLabelsError> {
    match rule {
        ChannelLabelRule::Name { contains } => {
            let contains = contains.trim();
            if contains.is_empty() || contains.chars().count() > MAX_SMART_TAG_PATTERN_LEN {
                return Err(ChannelLabelsError::BadRequest(format!(
                    "name pattern must be between 1 and {MAX_SMART_TAG_PATTERN_LEN} characters"
                )));
            }
            Ok(ChannelLabelRule::Name {
                contains: contains.to_string(),
            })
        }
    }
}

fn written(outcome: LabelWriteOutcome, name: &str) -> Result<ChannelLabel, ChannelLabelsError> {
    match outcome {
        LabelWriteOutcome::Written(label) => Ok(label),
        LabelWriteOutcome::NameTaken => Err(ChannelLabelsError::NameTaken(name.to_string())),
        LabelWriteOutcome::InvalidChannel(outcome) => {
            channel_write_result(outcome)?;
            Err(ChannelLabelsError::BadRequest(
                "invalid channel assignment".to_string(),
            ))
        }
        LabelWriteOutcome::NotFound => Err(ChannelLabelsError::NotFound("label not found")),
    }
}

impl<R> ChannelLabelsService for ChannelLabelsServiceImpl<R>
where
    R: ChannelLabelsRepo,
    anyhow::Error: From<R::Err>,
{
    #[tracing::instrument(err, skip(self))]
    async fn list_labels(
        &self,
        receipt: &ChannelLabelsReceipt,
    ) -> Result<Vec<ChannelLabel>, ChannelLabelsError> {
        Ok(self
            .repo
            .list_labels(receipt.scope(), receipt.user_id())
            .await
            .map_err(anyhow::Error::from)?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn create_label(
        &self,
        receipt: &ChannelLabelsReceipt,
        label: NewChannelLabel,
    ) -> Result<ChannelLabel, ChannelLabelsError> {
        let name = validate_name(&label.name)?;
        let rule = label.rule.map(validate_rule).transpose()?;
        if rule.is_some() && !label.channel_ids.is_empty() {
            return Err(ChannelLabelsError::BadRequest(
                "smart tags match channels automatically and cannot have manual assignments".into(),
            ));
        }
        let mut channel_ids = label.channel_ids;
        channel_ids.sort_unstable();
        channel_ids.dedup();
        written(
            self.repo
                .create_label(
                    receipt.scope(),
                    &name,
                    &channel_ids,
                    receipt.user_id(),
                    rule.as_ref(),
                )
                .await
                .map_err(anyhow::Error::from)?,
            &name,
        )
    }

    #[tracing::instrument(err, skip(self))]
    async fn rename_label(
        &self,
        receipt: &ChannelLabelsReceipt,
        label_id: Uuid,
        name: String,
        rule: Option<ChannelLabelRule>,
    ) -> Result<ChannelLabel, ChannelLabelsError> {
        let name = validate_name(&name)?;
        let rule = rule.map(validate_rule).transpose()?;
        if rule.is_some() {
            let existing = self
                .repo
                .get_label(receipt.scope(), label_id, receipt.user_id())
                .await
                .map_err(anyhow::Error::from)?
                .ok_or(ChannelLabelsError::NotFound("label not found"))?;
            if existing.rule.is_none() {
                return Err(ChannelLabelsError::BadRequest(
                    "only smart tags have editable rules".into(),
                ));
            }
        }
        written(
            self.repo
                .rename_label(
                    receipt.scope(),
                    label_id,
                    &name,
                    receipt.user_id(),
                    rule.as_ref(),
                )
                .await
                .map_err(anyhow::Error::from)?,
            &name,
        )
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_label(
        &self,
        receipt: &ChannelLabelsReceipt,
        label_id: Uuid,
    ) -> Result<(), ChannelLabelsError> {
        let removed = self
            .repo
            .delete_label(receipt.scope(), label_id)
            .await
            .map_err(anyhow::Error::from)?;
        if removed {
            Ok(())
        } else {
            Err(ChannelLabelsError::NotFound("label not found"))
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn set_channel_label(
        &self,
        receipt: &ChannelLabelsReceipt,
        channel_id: Uuid,
        label_id: Option<Uuid>,
    ) -> Result<(), ChannelLabelsError> {
        self.apply_channel_label(receipt, channel_id, label_id)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn preview_smart_tag(
        &self,
        receipt: &ChannelLabelsReceipt,
        rule: ChannelLabelRule,
    ) -> Result<SmartTagPreview, ChannelLabelsError> {
        let rule = validate_rule(rule)?;
        Ok(self
            .repo
            .preview_smart_tag(receipt.scope(), receipt.user_id(), &rule, 5)
            .await
            .map_err(anyhow::Error::from)?)
    }
}
