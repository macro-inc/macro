use super::util::Indent;
use crate::properties::Properties;
use crate::traits::TextAttachment;

pub struct Document {
    pub content: String,
    pub file_type: String,
    pub id: String,
    pub name: String,
    pub properties: Option<Properties>,
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
            .field("properties", &self.properties)
            .finish()
    }
}

impl std::fmt::Display for Document {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(
            f,
            r#"<document id="{}" file_type="{}" name="{}">"#,
            self.id, self.file_type, self.name
        )?;

        // Include properties before content if present
        if let Some(props) = &self.properties
            && !props.is_empty()
        {
            writeln!(f, "{}", Indent(4, props))?;
        }
        writeln!(f, "{}", Indent(4, "<content>"))?;
        writeln!(f, "{}", Indent(8, &self.content))?;
        writeln!(f, "{}", Indent(4, "</content>"))?;
        write!(f, "</document>")
    }
}

impl TextAttachment for Document {}

impl Document {
    pub fn boxed(self) -> Box<dyn TextAttachment> {
        Box::new(self)
    }
}
