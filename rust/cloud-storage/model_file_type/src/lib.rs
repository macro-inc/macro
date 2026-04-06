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
    (Executable, "executable", "Executable file association"),
    (Audio, "audio", "Audio player file association"),
    (Video, "video", "Video player file association"),
    (Font, "font", "Font viewer file association"),
    (Document, "document", "Document viewer file association"),
    (Database, "database", "Database file association"),
    (Data, "data", "Data file association"),
    (Vector, "vector", "Vector graphics file association"),
    (ThreeD, "3d", "3D model file association"),
    (Vm, "vm", "Virtual machine file association"),
    (Media, "media", "Media file association"),
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
    // Code block: generated from VS Code extensions {
    (Coffee, "coffee", "text/plain", Code),
    (Cson, "cson", "text/plain", Code),
    (Iced, "iced", "text/plain", Code),
    (C, "c", "text/plain", Code),
    (I, "i", "text/plain", Code),
    (Cpp, "cpp", "text/plain", Code),
    (Cppm, "cppm", "text/plain", Code),
    (Cc, "cc", "text/plain", Code),
    (Ccm, "ccm", "text/plain", Code),
    (Cxx, "cxx", "text/plain", Code),
    (Cxxm, "cxxm", "text/plain", Code),
    (CPlusPlus, "c++", "text/plain", Code),
    (CPlusPlusm, "c++m", "text/plain", Code),
    (Hpp, "hpp", "text/plain", Code),
    (Hh, "hh", "text/plain", Code),
    (Hxx, "hxx", "text/plain", Code),
    (HPlusPlus, "h++", "text/plain", Code),
    (H, "h", "text/plain", Code),
    (Ii, "ii", "text/plain", Code),
    (Ino, "ino", "text/plain", Code),
    (Inl, "inl", "text/plain", Code),
    (Ipp, "ipp", "text/plain", Code),
    (Ixx, "ixx", "text/plain", Code),
    (Tpp, "tpp", "text/plain", Code),
    (Txx, "txx", "text/plain", Code),
    (HppIn, "hpp.in", "text/plain", Code),
    (HIn, "h.in", "text/plain", Code),
    (Cu, "cu", "text/plain", Code),
    (Cuh, "cuh", "text/plain", Code),
    (Cs, "cs", "text/plain", Code),
    (Csx, "csx", "text/plain", Code),
    (Cake, "cake", "text/plain", Code),
    (Css, "css", "text/plain", Code),
    (Dart, "dart", "text/plain", Code),
    (Diff, "diff", "text/plain", Code),
    (Patch, "patch", "text/plain", Code),
    (Rej, "rej", "text/plain", Code),
    (Dockerfile, "dockerfile", "text/plain", Code),
    (Containerfile, "containerfile", "text/plain", Code),
    (Go, "go", "text/plain", Code),
    (Handlebars, "handlebars", "text/plain", Code),
    (Hbs, "hbs", "text/plain", Code),
    (Hjs, "hjs", "text/plain", Code),
    (Hlsl, "hlsl", "text/plain", Code),
    (Hlsli, "hlsli", "text/plain", Code),
    (Fx, "fx", "text/plain", Code),
    (Fxh, "fxh", "text/plain", Code),
    (Vsh, "vsh", "text/plain", Code),
    (Psh, "psh", "text/plain", Code),
    (Cginc, "cginc", "text/plain", Code),
    (Compute, "compute", "text/plain", Code),
    (Html, "html", "text/plain", Code),
    (Htm, "htm", "text/plain", Code),
    (Shtml, "shtml", "text/plain", Code),
    (Xhtml, "xhtml", "text/plain", Code),
    (Xht, "xht", "text/plain", Code),
    (Mdoc, "mdoc", "text/plain", Code),
    (Jsp, "jsp", "text/plain", Code),
    (Asp, "asp", "text/plain", Code),
    (Aspx, "aspx", "text/plain", Code),
    (Jshtm, "jshtm", "text/plain", Code),
    (Volt, "volt", "text/plain", Code),
    (Ejs, "ejs", "text/plain", Code),
    (Rhtml, "rhtml", "text/plain", Code),
    (Ini, "ini", "text/plain", Code),
    (Conf, "conf", "text/plain", Code),
    (Properties, "properties", "text/plain", Code),
    (Cfg, "cfg", "text/plain", Code),
    (Directory, "directory", "text/plain", Code),
    (Gitattributes, "gitattributes", "text/plain", Code),
    (Gitconfig, "gitconfig", "text/plain", Code),
    (Gitmodules, "gitmodules", "text/plain", Code),
    (Editorconfig, "editorconfig", "text/plain", Code),
    (Repo, "repo", "text/plain", Code),
    (Java, "java", "text/plain", Code),
    (Jav, "jav", "text/plain", Code),
    (Jsx, "jsx", "text/plain", Code),
    (Js, "js", "text/plain", Code),
    (Es6, "es6", "text/plain", Code),
    (Mjs, "mjs", "text/plain", Code),
    (Cjs, "cjs", "text/plain", Code),
    (Pac, "pac", "text/plain", Code),
    (Json, "json", "text/plain", Code),
    (Bowerrc, "bowerrc", "text/plain", Code),
    (Jscsrc, "jscsrc", "text/plain", Code),
    (Webmanifest, "webmanifest", "text/plain", Code),
    (JsMap, "js.map", "text/plain", Code),
    (CssMap, "css.map", "text/plain", Code),
    (TsMap, "ts.map", "text/plain", Code),
    (Har, "har", "text/plain", Code),
    (Jslintrc, "jslintrc", "text/plain", Code),
    (Jsonld, "jsonld", "text/plain", Code),
    (Geojson, "geojson", "text/plain", Code),
    (Ipynb, "ipynb", "text/plain", Code),
    (Vuerc, "vuerc", "text/plain", Code),
    (Jsonc, "jsonc", "text/plain", Code),
    (Eslintrc, "eslintrc", "text/plain", Code),
    (EslintrcJson, "eslintrc.json", "text/plain", Code),
    (Jsfmtrc, "jsfmtrc", "text/plain", Code),
    (Jshintrc, "jshintrc", "text/plain", Code),
    (Swcrc, "swcrc", "text/plain", Code),
    (Hintrc, "hintrc", "text/plain", Code),
    (Babelrc, "babelrc", "text/plain", Code),
    (Jsonl, "jsonl", "text/plain", Code),
    (Ndjson, "ndjson", "text/plain", Code),
    (CodeSnippets, "code-snippets", "text/plain", Code),
    (Jl, "jl", "text/plain", Code),
    (Jmd, "jmd", "text/plain", Code),
    (Sty, "sty", "text/plain", Code),
    (Cls, "cls", "text/plain", Code),
    (Bbx, "bbx", "text/plain", Code),
    (Cbx, "cbx", "text/plain", Code),
    (Tex, "tex", "text/plain", Code),
    (Ltx, "ltx", "text/plain", Code),
    (Ctx, "ctx", "text/plain", Code),
    (Bib, "bib", "text/plain", Code),
    (Less, "less", "text/plain", Code),
    (Log, "log", "text/plain", Code),
    (Lua, "lua", "text/plain", Code),
    (Mak, "mak", "text/plain", Code),
    (Mk, "mk", "text/plain", Code),
    (Mkd, "mkd", "text/plain", Code),
    (Mdwn, "mdwn", "text/plain", Code),
    (Mdown, "mdown", "text/plain", Code),
    (Markdown, "markdown", "text/plain", Code),
    (Markdn, "markdn", "text/plain", Code),
    (Mdtxt, "mdtxt", "text/plain", Code),
    (Mdtext, "mdtext", "text/plain", Code),
    (Workbook, "workbook", "text/plain", Code),
    (M, "m", "text/plain", Code),
    (Mm, "mm", "text/plain", Code),
    (Pl, "pl", "text/plain", Code),
    (Pm, "pm", "text/plain", Code),
    (Pod, "pod", "text/plain", Code),
    (T, "t", "text/plain", Code),
    (Psgi, "psgi", "text/plain", Code),
    (Raku, "raku", "text/plain", Code),
    (Rakumod, "rakumod", "text/plain", Code),
    (Rakutest, "rakutest", "text/plain", Code),
    (Rakudoc, "rakudoc", "text/plain", Code),
    (Nqp, "nqp", "text/plain", Code),
    (P6, "p6", "text/plain", Code),
    (Pl6, "pl6", "text/plain", Code),
    (Pm6, "pm6", "text/plain", Code),
    (Php, "php", "text/plain", Code),
    (Php4, "php4", "text/plain", Code),
    (Php5, "php5", "text/plain", Code),
    (Phtml, "phtml", "text/plain", Code),
    (Ctp, "ctp", "text/plain", Code),
    (Ps1, "ps1", "text/plain", Code),
    (Psm1, "psm1", "text/plain", Code),
    (Psd1, "psd1", "text/plain", Code),
    (Pssc, "pssc", "text/plain", Code),
    (Psrc, "psrc", "text/plain", Code),
    (Py, "py", "text/plain", Code),
    (Rpy, "rpy", "text/plain", Code),
    (Pyw, "pyw", "text/plain", Code),
    (Cpy, "cpy", "text/plain", Code),
    (Gyp, "gyp", "text/plain", Code),
    (Gypi, "gypi", "text/plain", Code),
    (Pyi, "pyi", "text/plain", Code),
    (Ipy, "ipy", "text/plain", Code),
    (Pyt, "pyt", "text/plain", Code),
    (R, "r", "text/plain", Code),
    (Rhistory, "rhistory", "text/plain", Code),
    (Rprofile, "rprofile", "text/plain", Code),
    (Rt, "rt", "text/plain", Code),
    (Cshtml, "cshtml", "text/plain", Code),
    (Razor, "razor", "text/plain", Code),
    (Rb, "rb", "text/plain", Code),
    (Rbx, "rbx", "text/plain", Code),
    (Rjs, "rjs", "text/plain", Code),
    (Gemspec, "gemspec", "text/plain", Code),
    (Rake, "rake", "text/plain", Code),
    (Ru, "ru", "text/plain", Code),
    (Erb, "erb", "text/plain", Code),
    (Podspec, "podspec", "text/plain", Code),
    (Rbi, "rbi", "text/plain", Code),
    (Rs, "rs", "text/plain", Code),
    (Scss, "scss", "text/plain", Code),
    (Sass, "sass", "text/plain", Code),
    (Shader, "shader", "text/plain", Code),
    (Sh, "sh", "text/plain", Code),
    (Bash, "bash", "text/plain", Code),
    (Bashrc, "bashrc", "text/plain", Code),
    (BashAliases, "bash_aliases", "text/plain", Code),
    (BashProfile, "bash_profile", "text/plain", Code),
    (BashLogin, "bash_login", "text/plain", Code),
    (Ebuild, "ebuild", "text/plain", Code),
    (Eclass, "eclass", "text/plain", Code),
    (Profile, "profile", "text/plain", Code),
    (BashLogout, "bash_logout", "text/plain", Code),
    (Xprofile, "xprofile", "text/plain", Code),
    (Xsession, "xsession", "text/plain", Code),
    (Xsessionrc, "xsessionrc", "text/plain", Code),
    (Zsh, "zsh", "text/plain", Code),
    (Zshrc, "zshrc", "text/plain", Code),
    (Zprofile, "zprofile", "text/plain", Code),
    (Zlogin, "zlogin", "text/plain", Code),
    (Zlogout, "zlogout", "text/plain", Code),
    (Zshenv, "zshenv", "text/plain", Code),
    (ZshTheme, "zsh-theme", "text/plain", Code),
    (Fish, "fish", "text/plain", Code),
    (Ksh, "ksh", "text/plain", Code),
    (Csh, "csh", "text/plain", Code),
    (Cshrc, "cshrc", "text/plain", Code),
    (Tcshrc, "tcshrc", "text/plain", Code),
    (Yashrc, "yashrc", "text/plain", Code),
    (YashProfile, "yash_profile", "text/plain", Code),
    (Sql, "sql", "text/plain", Code),
    (Dsql, "dsql", "text/plain", Code),
    (Swift, "swift", "text/plain", Code),
    (Ts, "ts", "text/plain", Code),
    (Cts, "cts", "text/plain", Code),
    (Mts, "mts", "text/plain", Code),
    (Tsx, "tsx", "text/plain", Code),
    (Tsbuildinfo, "tsbuildinfo", "text/plain", Code),
    (Xml, "xml", "text/plain", Code),
    (Xsd, "xsd", "text/plain", Code),
    (Ascx, "ascx", "text/plain", Code),
    (Atom, "atom", "text/plain", Code),
    (Axml, "axml", "text/plain", Code),
    (Axaml, "axaml", "text/plain", Code),
    (Bpmn, "bpmn", "text/plain", Code),
    (Cpt, "cpt", "text/plain", Code),
    (Csl, "csl", "text/plain", Code),
    (Csproj, "csproj", "text/plain", Code),
    (CsprojUser, "csproj.user", "text/plain", Code),
    (Dita, "dita", "text/plain", Code),
    (Ditamap, "ditamap", "text/plain", Code),
    (Dtd, "dtd", "text/plain", Code),
    (Ent, "ent", "text/plain", Code),
    (Mod, "mod", "text/plain", Code),
    (Dtml, "dtml", "text/plain", Code),
    (Fsproj, "fsproj", "text/plain", Code),
    (Fxml, "fxml", "text/plain", Code),
    (Iml, "iml", "text/plain", Code),
    (Isml, "isml", "text/plain", Code),
    (Jmx, "jmx", "text/plain", Code),
    (Launch, "launch", "text/plain", Code),
    (Menu, "menu", "text/plain", Code),
    (Mxml, "mxml", "text/plain", Code),
    (Nuspec, "nuspec", "text/plain", Code),
    (Opml, "opml", "text/plain", Code),
    (Owl, "owl", "text/plain", Code),
    (Proj, "proj", "text/plain", Code),
    (Props, "props", "text/plain", Code),
    (Pt, "pt", "text/plain", Code),
    (Publishsettings, "publishsettings", "text/plain", Code),
    (Pubxml, "pubxml", "text/plain", Code),
    (PubxmlUser, "pubxml.user", "text/plain", Code),
    (Rbxlx, "rbxlx", "text/plain", Code),
    (Rbxmx, "rbxmx", "text/plain", Code),
    (Rdf, "rdf", "text/plain", Code),
    (Rng, "rng", "text/plain", Code),
    (Rss, "rss", "text/plain", Code),
    (Shproj, "shproj", "text/plain", Code),
    (Storyboard, "storyboard", "text/plain", Code),
    (Targets, "targets", "text/plain", Code),
    (Tld, "tld", "text/plain", Code),
    (Tmx, "tmx", "text/plain", Code),
    (Vbproj, "vbproj", "text/plain", Code),
    (VbprojUser, "vbproj.user", "text/plain", Code),
    (Vcxproj, "vcxproj", "text/plain", Code),
    (VcxprojFilters, "vcxproj.filters", "text/plain", Code),
    (Wsdl, "wsdl", "text/plain", Code),
    (Wxi, "wxi", "text/plain", Code),
    (Wxl, "wxl", "text/plain", Code),
    (Wxs, "wxs", "text/plain", Code),
    (Xaml, "xaml", "text/plain", Code),
    (Xbl, "xbl", "text/plain", Code),
    (Xib, "xib", "text/plain", Code),
    (Xlf, "xlf", "text/plain", Code),
    (Xliff, "xliff", "text/plain", Code),
    (Xpdl, "xpdl", "text/plain", Code),
    (Xul, "xul", "text/plain", Code),
    (Xoml, "xoml", "text/plain", Code),
    (Xsl, "xsl", "text/plain", Code),
    (Xslt, "xslt", "text/plain", Code),
    (Yaml, "yaml", "text/plain", Code),
    (Yml, "yml", "text/plain", Code),
    (Eyaml, "eyaml", "text/plain", Code),
    (Eyml, "eyml", "text/plain", Code),
    (Cff, "cff", "text/plain", Code),
    (YamlTmlanguage, "yaml-tmlanguage", "text/plain", Code),
    (YamlTmpreferences, "yaml-tmpreferences", "text/plain", Code),
    (YamlTmtheme, "yaml-tmtheme", "text/plain", Code),
    (Winget, "winget", "text/plain", Code),
    (Txt, "txt", "text/plain", Code),
    (Csv, "csv", "text/plain", Code),
    (Tsv, "tsv", "text/plain", Code),
    // } Code block
    // images
    (Jpeg, "jpeg", "image/jpeg", Image),
    (Jpg, "jpg", "image/jpeg", Image),
    (Png, "png", "image/png", Image),
    (Gif, "gif", "image/gif", Image),
    (Svg, "svg", "image/svg+xml", Image),
    (Webp, "webp", "image/webp", Image),
    (Avif, "avif", "image/avif", Image),
    (Bmp, "bmp", "image/bmp", Image),
    (Ico, "ico", "image/x-icon", Image),
    (Tiff, "tiff", "image/tiff", Image),
    (Tif, "tif", "image/tiff", Image),
    (Heic, "heic", "image/heic", Image),
    (Heif, "heif", "image/heif", Image),
    // NOT SUPPORTED BLOCKS

    // Archives and compressed files
    (Tar, "tar", "application/x-tar", Archive),
    (TarGz, "tar.gz", "application/gzip", Archive),
    (Tgz, "tgz", "application/gzip", Archive),
    (Gz, "gz", "application/gzip", Archive),
    (Bz2, "bz2", "application/x-bzip2", Archive),
    (TarBz2, "tar.bz2", "application/x-bzip2", Archive),
    (Tbz2, "tbz2", "application/x-bzip2", Archive),
    (Z, "z", "application/x-compress", Archive),
    (TarZ, "tar.z", "application/x-compress", Archive),
    (Lz, "lz", "application/x-lzip", Archive),
    (TarLz, "tar.lz", "application/x-lzip", Archive),
    (Xz, "xz", "application/x-xz", Archive),
    (TarXz, "tar.xz", "application/x-xz", Archive),
    (Txz, "txz", "application/x-xz", Archive),
    (Lzma, "lzma", "application/x-lzma", Archive),
    (TarLzma, "tar.lzma", "application/x-lzma", Archive),
    (Rar, "rar", "application/vnd.rar", Archive),
    (SevenZ, "7z", "application/x-7z-compressed", Archive),
    (Zst, "zst", "application/zstd", Archive),
    (TarZst, "tar.zst", "application/zstd", Archive),
    (Tzst, "tzst", "application/zstd", Archive),
    (Zip, "zip", "application/zip", Archive),
    // Executable files
    (Exe, "exe", "application/x-msdownload", Executable),
    (Msi, "msi", "application/x-msi", Executable),
    (Dll, "dll", "application/x-msdownload", Executable),
    (Bat, "bat", "application/x-bat", Executable),
    (Cmd, "cmd", "application/x-cmd", Executable),
    (Com, "com", "application/x-msdownload", Executable),
    (AppImage, "appimage", "application/x-executable", Executable),
    (App, "app", "application/x-executable", Executable),
    (Bin, "bin", "application/octet-stream", Executable),
    (
        Deb,
        "deb",
        "application/vnd.debian.binary-package",
        Executable
    ),
    (Rpm, "rpm", "application/x-rpm", Executable),
    (
        Apk,
        "apk",
        "application/vnd.android.package-archive",
        Executable
    ),
    (Dmg, "dmg", "application/x-apple-diskimage", Executable),
    (
        Pkg,
        "pkg",
        "application/vnd.apple.installer+xml",
        Executable
    ),
    (Crx, "crx", "application/x-chrome-extension", Executable),
    (Xpi, "xpi", "application/x-xpinstall", Executable),
    // Audio files
    (Mp3, "mp3", "audio/mpeg", Audio),
    (Wav, "wav", "audio/wav", Audio),
    (Ogg, "ogg", "audio/ogg", Audio),
    (Flac, "flac", "audio/flac", Audio),
    (Aac, "aac", "audio/aac", Audio),
    (M4a, "m4a", "audio/mp4", Audio),
    (Wma, "wma", "audio/x-ms-wma", Audio),
    (Mid, "mid", "audio/midi", Audio),
    (Midi, "midi", "audio/midi", Audio),
    // Video files
    (Mp4, "mp4", "video/mp4", Video),
    (Mkv, "mkv", "video/x-matroska", Video),
    (Webm, "webm", "video/webm", Video),
    (Avi, "avi", "video/x-msvideo", Video),
    (Mov, "mov", "video/quicktime", Video),
    (Wmv, "wmv", "video/x-ms-wmv", Video),
    (Mpg, "mpg", "video/mpeg", Video),
    (Mpeg, "mpeg", "video/mpeg", Video),
    (M4v, "m4v", "video/mp4", Video),
    (Flv, "flv", "video/x-flv", Video),
    (F4v, "f4v", "video/mp4", Video),
    (ThreeGp, "3gp", "video/3gpp", Video),
    // Font files
    (Ttf, "ttf", "font/ttf", Font),
    (Otf, "otf", "font/otf", Font),
    (Woff, "woff", "font/woff", Font),
    (Woff2, "woff2", "font/woff2", Font),
    (Eot, "eot", "application/vnd.ms-fontobject", Font),
    // Document formats
    (Rtf, "rtf", "application/rtf", Document),
    (
        Odt,
        "odt",
        "application/vnd.oasis.opendocument.text",
        Document
    ),
    (
        Ods,
        "ods",
        "application/vnd.oasis.opendocument.spreadsheet",
        Document
    ),
    (
        Odp,
        "odp",
        "application/vnd.oasis.opendocument.presentation",
        Document
    ),
    (
        Odg,
        "odg",
        "application/vnd.oasis.opendocument.graphics",
        Document
    ),
    (
        Odf,
        "odf",
        "application/vnd.oasis.opendocument.formula",
        Document
    ),
    (Epub, "epub", "application/epub+zip", Document),
    (Mobi, "mobi", "application/x-mobipocket-ebook", Document),
    (Azw, "azw", "application/vnd.amazon.ebook", Document),
    (Azw3, "azw3", "application/vnd.amazon.ebook", Document),
    (Djvu, "djvu", "image/vnd.djvu", Document),
    (Xls, "xls", "application/vnd.ms-excel", Document),
    (Ppt, "ppt", "application/vnd.ms-powerpoint", Document),
    (Pptx, "pptx", "application/xml", Document),
    (Xlsx, "xlsx", "application/xml", Document),
    // Database files
    (Db, "db", "application/octet-stream", Database),
    (Sqlite, "sqlite", "application/vnd.sqlite3", Database),
    (Sqlite3, "sqlite3", "application/vnd.sqlite3", Database),
    (Mdb, "mdb", "application/vnd.ms-access", Database),
    (Accdb, "accdb", "application/vnd.ms-access", Database),
    (Dbf, "dbf", "application/x-dbf", Database),
    // Data and config files
    (Plist, "plist", "application/xml", Data),
    (Toml, "toml", "application/toml", Data),
    (Env, "env", "text/plain", Data),
    (Dot, "dot", "text/vnd.graphviz", Data),
    (Gv, "gv", "text/vnd.graphviz", Data),
    (Torrent, "torrent", "application/x-bittorrent", Data),
    (Ics, "ics", "text/calendar", Data),
    (Vcf, "vcf", "text/vcard", Data),
    // Vector graphics
    (Ai, "ai", "application/postscript", Vector),
    (Eps, "eps", "application/postscript", Vector),
    (Ps, "ps", "application/postscript", Vector),
    (Dxf, "dxf", "image/vnd.dxf", Vector),
    (Dwg, "dwg", "image/vnd.dwg", Vector),
    // 3D files
    (Stl, "stl", "model/stl", ThreeD),
    (Obj, "obj", "model/obj", ThreeD),
    (Fbx, "fbx", "application/octet-stream", ThreeD),
    (Blend, "blend", "application/x-blender", ThreeD),
    (Dae, "dae", "model/vnd.collada+xml", ThreeD),
    (ThreeDs, "3ds", "application/x-3ds", ThreeD),
    (Gltf, "gltf", "model/gltf+json", ThreeD),
    (Glb, "glb", "model/gltf-binary", ThreeD),
    // Virtual machine and container files
    (Vhd, "vhd", "application/x-virtualbox-vhd", Vm),
    (Vhdx, "vhdx", "application/x-virtualbox-vhdx", Vm),
    (Vmdk, "vmdk", "application/x-vmdk", Vm),
    (Ova, "ova", "application/x-virtualbox-ova", Vm),
    (Ovf, "ovf", "application/x-virtualbox-ovf", Vm),
    (Iso, "iso", "application/x-iso9660-image", Vm),
    (Img, "img", "application/octet-stream", Vm),
    // Miscellaneous
    (Swf, "swf", "application/x-shockwave-flash", Media),
);
