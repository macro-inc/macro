use lexical_model::EditorBuilder;

/// Append Group A input policy to a live surface or its permission fork.
pub fn register(builder: EditorBuilder, ty: crate::EditorType) -> EditorBuilder {
    if matches!(ty, crate::EditorType::Title | crate::EditorType::PlainText) {
        return builder;
    }
    super::menu::register(super::shortcuts::register(builder))
}
