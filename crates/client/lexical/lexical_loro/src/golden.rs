//! Frozen common ancestor for every persisted Markdown document.
/// Original shared snapshot; never regenerate or substitute these bytes.
pub static MARKDOWN_GOLDEN: &[u8] =
    include_bytes!("../../../../../static_assets/markdown-golden.1.bin");
