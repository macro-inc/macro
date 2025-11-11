mod suffix_trie;
pub use model_file_type::{ContentType, FileType};
use std::sync::LazyLock;
use suffix_trie::ReversedSuffixTrie;

#[cfg(test)]
mod tests;

static SUFFIX_TRIE: LazyLock<ReversedSuffixTrie> = LazyLock::new(|| {
    let mut trie = ReversedSuffixTrie::new();

    for ft in FileType::all() {
        // Push dot and suffix into a String directly
        let mut buf = String::with_capacity(ft.as_str().len() + 1);
        buf.push('.');
        buf.push_str(ft.as_str());

        trie.insert(&buf); // avoid heap realloc / format! / as_str()
    }

    trie
});

const PLAINTEXT_TYPES: &[&str] = &["application/x-macro-canvas"];

/// extension methods for the [FileType] enum
pub trait FileTypeExt {
    /// attempts to return the document name only if it can be parsed out of .e.g file.txt -> file
    fn clean_document_name(document_name: &str) -> Option<String> {
        FileType::split_suffix_match(document_name).map(|(s, _)| s.to_string())
    }

    /// returns true if the file type is an image
    fn is_image(&self) -> bool;

    /// returns true if the document cannot be modified in macro
    fn is_static(&self) -> bool;

    /// the opposite of [FileTypeExt::is_static]
    fn is_editable(&self) -> bool {
        !self.is_static()
    }

    /// returns true if the input filename has a supported suffix
    fn is_suffix_match(filename: &str) -> bool {
        SUFFIX_TRIE.string_has_suffix(filename)
    }

    // Returns the file prefix and the extension (no period)
    fn split_suffix_match(filename: &str) -> Option<(&str, &str)> {
        SUFFIX_TRIE.split_suffix(filename)
    }

    /// return true if the file type contains readable text content
    fn is_text_content(&self) -> bool;
}

impl FileTypeExt for FileType {
    fn is_image(&self) -> bool {
        matches!(
            self,
            FileType::Png | FileType::Jpg | FileType::Gif | FileType::Svg
        )
    }

    fn is_static(&self) -> bool {
        matches!(self, FileType::Pdf) || self.is_image()
    }

    fn is_text_content(&self) -> bool {
        if self == &FileType::Pdf || self == &FileType::Docx {
            return true;
        }
        let mime_type = self.mime_type();
        if PLAINTEXT_TYPES.contains(&mime_type) {
            true
        } else {
            mime_type.starts_with("text")
        }
    }
}

/// extension trait for [ContentType]
pub trait ContentTypeExt {
    /// return true if the content type is an image
    fn is_image(&self) -> bool;
    /// return true if the content type contains readable text
    fn is_text_content(&self) -> bool;
}

impl ContentTypeExt for ContentType {
    fn is_image(&self) -> bool {
        self.mime_type().starts_with("image/")
    }

    fn is_text_content(&self) -> bool {
        match self {
            ContentType::Pdf | ContentType::Docx => true,
            _ => {
                let mime_type = self.mime_type();
                mime_type.starts_with("text/") || PLAINTEXT_TYPES.contains(&mime_type)
            }
        }
    }
}
