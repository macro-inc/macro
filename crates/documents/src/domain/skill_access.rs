//! Protect instructions consumed by later unrestricted runs.
use super::models::DocumentError;
use document_sub_type::DocumentSubType;

/// Ordinary Markdown is handled by the caller's normal authorization. Skill
/// writes also require a run that may persist instructions for future work.
pub(crate) fn ensure_skill_write(sub_type: Option<DocumentSubType>) -> Result<(), DocumentError> {
    if sub_type == Some(DocumentSubType::Skill)
        && (agent_correlation::context::current_channel_mention().is_some()
            || agent_correlation::context::current_scope()
                == Some(agent_correlation::scope::SessionScope::NoSend))
    {
        return Err(DocumentError::Forbidden(
            "Saved skill instructions cannot be changed from this restricted run. Edit the skill from Macro.".into(),
        ));
    }
    Ok(())
}
