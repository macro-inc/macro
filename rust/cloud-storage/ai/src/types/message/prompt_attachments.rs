use std::sync::Arc;

use crate::traits::TextAttachment;

#[derive(Debug, Clone, Default)]
pub struct PromptAttachments(Vec<Arc<dyn TextAttachment>>);

impl<T> From<Vec<T>> for PromptAttachments
where
    T: TextAttachment + 'static,
{
    fn from(value: Vec<T>) -> Self {
        Self(
            value
                .into_iter()
                .map(|a| Arc::new(a) as Arc<dyn TextAttachment>)
                .collect(),
        )
    }
}

impl From<Vec<Arc<dyn TextAttachment>>> for PromptAttachments {
    fn from(value: Vec<Arc<dyn TextAttachment>>) -> Self {
        Self(value)
    }
}

impl std::ops::Deref for PromptAttachments {
    type Target = Vec<Arc<dyn TextAttachment>>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
