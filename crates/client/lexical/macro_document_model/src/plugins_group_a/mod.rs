//! Application input and menu policy, registered independently of other migration groups.
use lexical_model::EditorBuilder;
mod shortcuts;

/// Append Group A input policy to a live surface or its permission fork.
pub fn register(builder: EditorBuilder, ty: crate::EditorType) -> EditorBuilder {
    if matches!(ty, crate::EditorType::Title | crate::EditorType::PlainText) {
        return builder;
    }
    shortcuts::register(builder)
}

#[cfg(test)]
mod shortcuts_test;
