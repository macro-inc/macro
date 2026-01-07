use ai::traits::TextAttachment;

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

impl Document {
    pub fn boxed(self) -> Box<dyn TextAttachment> {
        Box::new(self)
    }
}
