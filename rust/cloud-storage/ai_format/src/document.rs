use ai::traits::TextAttachment;
use std::sync::Arc;

pub struct Document {
    pub content: String,
    pub file_type: String,
    pub id: String,
    pub name: String,
}

impl std::fmt::Debug for Document {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Document")
            .field(
                "content",
                &format!("content [{} chars]", self.content.len()),
            )
            .field("file_type", &self.file_type)
            .field("id", &self.id)
            .field("name", &self.name)
            .finish()
    }
}

impl std::fmt::Display for Document {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            r#"<document id="{}" file_type="{}" name="{}">
    <content>
        {}
    </content>
</document>"#,
            self.id, self.file_type, self.name, self.content
        )
    }
}

impl TextAttachment for Document {}
impl Into<Arc<dyn TextAttachment>> for Document {
    fn into(self) -> Arc<dyn TextAttachment> {
        Arc::new(self)
    }
}

impl Document {
    pub fn type_erase(self) -> Arc<dyn TextAttachment> {
        self.into()
    }
}
