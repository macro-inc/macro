use crate::traits::TextAttachment;

#[derive(Debug, Clone, Default)]
pub struct PromptAttachments(Vec<String>);

impl<T> From<Vec<T>> for PromptAttachments
where
    T: TextAttachment + 'static,
{
    fn from(value: Vec<T>) -> Self {
        Self(value.into_iter().map(|a| a.to_string()).collect())
    }
}

impl From<&[&dyn TextAttachment]> for PromptAttachments {
    fn from(value: &[&dyn TextAttachment]) -> Self {
        Self(value.iter().map(|a| a.to_string()).collect())
    }
}

impl std::ops::Deref for PromptAttachments {
    type Target = Vec<String>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
