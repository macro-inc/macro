#![deny(missing_docs)]

//! This crate is used to define an enumeration of all the [FileType] and [ContentType] that are compatible with Macro

use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::marker::PhantomData;
use std::str::FromStr;
use strum::EnumIter;
use thiserror::Error;

/// Indicates we eoncountered an unknown string value while attempting to construct type T
#[derive(Debug, Error)]
#[error("{0} is not a supported {t}", t = std::any::type_name::<T>())]
pub struct ValueError<T>(String, PhantomData<T>);

struct Lowercase<'a>(Cow<'a, str>);

impl<'a> Lowercase<'a> {
    fn new(s: &'a str) -> Self {
        Self(match s.chars().any(|c| c.is_ascii_uppercase()) {
            true => {
                let mut string = s.to_string();
                string.make_ascii_lowercase();
                Cow::Owned(string)
            }
            false => Cow::Borrowed(s),
        })
    }
}

macro_rules! generate_file_types {
    ($(($variant:ident, $str_name:expr, $mime_type:expr, $app_path:ident)),* $(,)?) => {
        /// Generates a FileType enum and associated ContentType enum with their implementations.
        ///
        /// This macro takes a list of tuples in the format:
        /// (Variant, "extension", "mime_type", CONTENT_TYPE_VARIANT)
        ///
        /// For each tuple it generates:
        /// - A variant in the FileType enum
        /// - A variant in the ContentType enum
        /// - Implementations for:
        ///   - FileType::to_str() - Converts FileType to extension string
        ///   - FileType::from_str() - Converts extension string to FileType
        ///   - From<FileType> for ContentType - Maps FileType to ContentType
        ///   - ContentType::mime_type() - Gets MIME type for ContentType
        ///
        #[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Copy, Clone, EnumIter)]
        #[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
        #[serde(rename_all = "lowercase")]
        pub enum FileType {
            $(
                #[expect(missing_docs)]
                $variant,
            )*
        }

        impl FromStr for FileType {
            type Err = ValueError<Self>;
            fn from_str(file_type: &str) -> Result<Self, Self::Err> {

                let lowercase = Lowercase::new(file_type.trim_start_matches('.')); // remove leading dot

                match lowercase.0.as_ref() {
                    $(
                        $str_name => Ok(FileType::$variant),
                    )*
                    _ => {
                        Err(ValueError(lowercase.0.into_owned(), PhantomData))
                    }
                }
            }
        }

        impl FileType {
            /// return the file extension as a string slice
            pub fn as_str(&self) -> &'static str {
                match self {
                    $(
                        FileType::$variant => $str_name,
                    )*
                }
            }

            /// return the mime type as a string slice
            pub fn mime_type(&self) -> &'static str {
                match self {
                    $(
                        FileType::$variant => $mime_type,
                    )*
                }
            }

            /// return the app path for the file type
            pub fn macro_app_path(&self) -> FileAssociation {
                match self {
                    $(
                        FileType::$variant => FileAssociation::from($app_path),
                    )*
                }
            }

            /// return all possible values as a slice
            pub fn all() -> &'static [FileType] {
                &[
                    $(
                        FileType::$variant,
                    )*
                ]
            }
        }

        impl std::fmt::Display for FileType {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                match self {
                    $(
                        FileType::$variant => write!(f, "{}", $str_name),
                    )*
                }
            }
        }


        /// the possible content types that are associated with macro
        #[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
        pub enum ContentType {
            $(
                #[expect(missing_docs)]
                $variant,
            )*
            /// the default content type of application/octet-stream
            Default,
        }

        impl From<FileType> for ContentType {
            fn from(file_type: FileType) -> Self {
                match file_type {
                    $(
                        FileType::$variant => ContentType::$variant,
                    )*
                }
            }
        }

        impl From<Option<FileType>> for ContentType {
            fn from(file_type: Option<FileType>) -> Self {
                match file_type {
                    Some(file_type) => file_type.into(),
                    None => ContentType::Default,
                }
            }
        }

        impl FromStr for ContentType {
            type Err = ValueError<Self>;
            fn from_str(mime_type: &str) -> Result<Self, Self::Err> {
                let cleaned = mime_type.to_ascii_lowercase();

                // there can be multiple variants for the same mime type
                // but it does not matter for the purposes of this function
                #[expect(unreachable_patterns)]
                match cleaned.as_str() {
                    $(
                        $mime_type => Ok(ContentType::$variant),
                    )*
                    _ => {
                        Err(ValueError(cleaned, PhantomData))
                    }
                }
            }

        }

        impl ContentType {
            /// return the mime type of self as a string slice
            pub fn mime_type(&self) -> &'static str {
                match self {
                    $(
                        ContentType::$variant => $mime_type,
                    )*
                    ContentType::Default => "application/octet-stream",
                }
            }
        }
    };
}

macro_rules! define_file_associations {
    (
        $(
            ($struct_name:ident, $display_str:literal, $doc:literal)
        ),* $(,)?
    ) => {
        $(
            #[doc = $doc]
            #[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
            pub struct $struct_name;
        )*

        /// File association type for routing files to the appropriate application
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum FileAssociation {
            $(
                #[doc = $doc]
                $struct_name($struct_name),
            )*
        }

        impl std::fmt::Display for FileAssociation {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                match self {
                    $(
                        FileAssociation::$struct_name(_) => write!(f, $display_str),
                    )*
                }
            }
        }

        $(
            impl From<$struct_name> for FileAssociation {
                fn from(value: $struct_name) -> Self {
                    FileAssociation::$struct_name(value)
                }
            }
        )*
    };
}

define_file_associations!(
    (Write, "write", "Write application file association"),
    (Pdf, "pdf", "PDF viewer file association"),
    (Md, "md", "Markdown editor file association"),
    (Canvas, "canvas", "Canvas editor file association"),
    (Code, "code", "Code editor file association"),
    (Image, "image", "Image viewer file association"),
    (Archive, "archive", "Archive file association"),
    (Video, "video", "Video player file association"),
    (Document, "document", "Document viewer file association"),
);

generate_file_types!(
    (
        Docx,
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Write
    ),
    (Pdf, "pdf", "application/pdf", Pdf),
    (Md, "md", "text/markdown", Md),
    (Canvas, "canvas", "application/x-macro-canvas", Canvas),
    // Code files
    (Py, "py", "text/plain", Code),
    (Js, "js", "text/plain", Code),
    (Ts, "ts", "text/plain", Code),
    (Jsx, "jsx", "text/plain", Code),
    (Tsx, "tsx", "text/plain", Code),
    (Json, "json", "text/plain", Code),
    (Html, "html", "text/plain", Code),
    (Css, "css", "text/plain", Code),
    (Xml, "xml", "text/plain", Code),
    (Yaml, "yaml", "text/plain", Code),
    (Yml, "yml", "text/plain", Code),
    (Sql, "sql", "text/plain", Code),
    (Sh, "sh", "text/plain", Code),
    (Bash, "bash", "text/plain", Code),
    (Markdown, "markdown", "text/plain", Code),
    (Txt, "txt", "text/plain", Code),
    (Csv, "csv", "text/plain", Code),
    // images
    (Jpeg, "jpeg", "image/jpeg", Image),
    (Jpg, "jpg", "image/jpeg", Image),
    (Png, "png", "image/png", Image),
    (Gif, "gif", "image/gif", Image),
    (Svg, "svg", "image/svg+xml", Image),
    (Webp, "webp", "image/webp", Image),
    (Heic, "heic", "image/heic", Image),
    (Heif, "heif", "image/heif", Image),
    // Archives
    (Zip, "zip", "application/zip", Archive),
    (Tar, "tar", "application/x-tar", Archive),
    (TarGz, "tar.gz", "application/gzip", Archive),
    (Tgz, "tgz", "application/gzip", Archive),
    (Gz, "gz", "application/gzip", Archive),
    // Video files
    (Mp4, "mp4", "video/mp4", Video),
    // Document formats
    (Xls, "xls", "application/vnd.ms-excel", Document),
    (Ppt, "ppt", "application/vnd.ms-powerpoint", Document),
    (Pptx, "pptx", "application/xml", Document),
    (Xlsx, "xlsx", "application/xml", Document),
);
