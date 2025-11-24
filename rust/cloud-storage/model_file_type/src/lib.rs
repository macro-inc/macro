#![deny(missing_docs)]

//! This crate is used to define an enumeration of all the [FileType] and [ContentType] that are compatible with Macro

use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::marker::PhantomData;
use std::str::FromStr;
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
    ($(($variant:ident, $str_name:expr, $mime_type:expr, $app_path:expr)),* $(,)?) => {
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
        #[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Copy, Clone)]
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
            pub fn macro_app_path(&self) -> String {
                match self {
                    $(
                        FileType::$variant => $app_path.to_string(),
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

generate_file_types!(
    (
        Docx,
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "write"
    ),
    (Pdf, "pdf", "application/pdf", "pdf"),
    (Md, "md", "text/markdown", "md"),
    (Canvas, "canvas", "application/x-macro-canvas", "canvas"),
    // Code block: generated from VS Code extensions {
    (Coffee, "coffee", "text/plain", "code"),
    (Cson, "cson", "text/plain", "code"),
    (Iced, "iced", "text/plain", "code"),
    (C, "c", "text/plain", "code"),
    (I, "i", "text/plain", "code"),
    (Cpp, "cpp", "text/plain", "code"),
    (Cppm, "cppm", "text/plain", "code"),
    (Cc, "cc", "text/plain", "code"),
    (Ccm, "ccm", "text/plain", "code"),
    (Cxx, "cxx", "text/plain", "code"),
    (Cxxm, "cxxm", "text/plain", "code"),
    (CPlusPlus, "c++", "text/plain", "code"),
    (CPlusPlusm, "c++m", "text/plain", "code"),
    (Hpp, "hpp", "text/plain", "code"),
    (Hh, "hh", "text/plain", "code"),
    (Hxx, "hxx", "text/plain", "code"),
    (HPlusPlus, "h++", "text/plain", "code"),
    (H, "h", "text/plain", "code"),
    (Ii, "ii", "text/plain", "code"),
    (Ino, "ino", "text/plain", "code"),
    (Inl, "inl", "text/plain", "code"),
    (Ipp, "ipp", "text/plain", "code"),
    (Ixx, "ixx", "text/plain", "code"),
    (Tpp, "tpp", "text/plain", "code"),
    (Txx, "txx", "text/plain", "code"),
    (HppIn, "hpp.in", "text/plain", "code"),
    (HIn, "h.in", "text/plain", "code"),
    (Cu, "cu", "text/plain", "code"),
    (Cuh, "cuh", "text/plain", "code"),
    (Cs, "cs", "text/plain", "code"),
    (Csx, "csx", "text/plain", "code"),
    (Cake, "cake", "text/plain", "code"),
    (Css, "css", "text/plain", "code"),
    (Dart, "dart", "text/plain", "code"),
    (Diff, "diff", "text/plain", "code"),
    (Patch, "patch", "text/plain", "code"),
    (Rej, "rej", "text/plain", "code"),
    (Dockerfile, "dockerfile", "text/plain", "code"),
    (Containerfile, "containerfile", "text/plain", "code"),
    (Go, "go", "text/plain", "code"),
    (Handlebars, "handlebars", "text/plain", "code"),
    (Hbs, "hbs", "text/plain", "code"),
    (Hjs, "hjs", "text/plain", "code"),
    (Hlsl, "hlsl", "text/plain", "code"),
    (Hlsli, "hlsli", "text/plain", "code"),
    (Fx, "fx", "text/plain", "code"),
    (Fxh, "fxh", "text/plain", "code"),
    (Vsh, "vsh", "text/plain", "code"),
    (Psh, "psh", "text/plain", "code"),
    (Cginc, "cginc", "text/plain", "code"),
    (Compute, "compute", "text/plain", "code"),
    (Html, "html", "text/plain", "code"),
    (Htm, "htm", "text/plain", "code"),
    (Shtml, "shtml", "text/plain", "code"),
    (Xhtml, "xhtml", "text/plain", "code"),
    (Xht, "xht", "text/plain", "code"),
    (Mdoc, "mdoc", "text/plain", "code"),
    (Jsp, "jsp", "text/plain", "code"),
    (Asp, "asp", "text/plain", "code"),
    (Aspx, "aspx", "text/plain", "code"),
    (Jshtm, "jshtm", "text/plain", "code"),
    (Volt, "volt", "text/plain", "code"),
    (Ejs, "ejs", "text/plain", "code"),
    (Rhtml, "rhtml", "text/plain", "code"),
    (Ini, "ini", "text/plain", "code"),
    (Conf, "conf", "text/plain", "code"),
    (Properties, "properties", "text/plain", "code"),
    (Cfg, "cfg", "text/plain", "code"),
    (Directory, "directory", "text/plain", "code"),
    (Gitattributes, "gitattributes", "text/plain", "code"),
    (Gitconfig, "gitconfig", "text/plain", "code"),
    (Gitmodules, "gitmodules", "text/plain", "code"),
    (Editorconfig, "editorconfig", "text/plain", "code"),
    (Repo, "repo", "text/plain", "code"),
    (Java, "java", "text/plain", "code"),
    (Jav, "jav", "text/plain", "code"),
    (Jsx, "jsx", "text/plain", "code"),
    (Js, "js", "text/plain", "code"),
    (Es6, "es6", "text/plain", "code"),
    (Mjs, "mjs", "text/plain", "code"),
    (Cjs, "cjs", "text/plain", "code"),
    (Pac, "pac", "text/plain", "code"),
    (Json, "json", "text/plain", "code"),
    (Bowerrc, "bowerrc", "text/plain", "code"),
    (Jscsrc, "jscsrc", "text/plain", "code"),
    (Webmanifest, "webmanifest", "text/plain", "code"),
    (JsMap, "js.map", "text/plain", "code"),
    (CssMap, "css.map", "text/plain", "code"),
    (TsMap, "ts.map", "text/plain", "code"),
    (Har, "har", "text/plain", "code"),
    (Jslintrc, "jslintrc", "text/plain", "code"),
    (Jsonld, "jsonld", "text/plain", "code"),
    (Geojson, "geojson", "text/plain", "code"),
    (Ipynb, "ipynb", "text/plain", "code"),
    (Vuerc, "vuerc", "text/plain", "code"),
    (Jsonc, "jsonc", "text/plain", "code"),
    (Eslintrc, "eslintrc", "text/plain", "code"),
    (EslintrcJson, "eslintrc.json", "text/plain", "code"),
    (Jsfmtrc, "jsfmtrc", "text/plain", "code"),
    (Jshintrc, "jshintrc", "text/plain", "code"),
    (Swcrc, "swcrc", "text/plain", "code"),
    (Hintrc, "hintrc", "text/plain", "code"),
    (Babelrc, "babelrc", "text/plain", "code"),
    (Jsonl, "jsonl", "text/plain", "code"),
    (Ndjson, "ndjson", "text/plain", "code"),
    (CodeSnippets, "code-snippets", "text/plain", "code"),
    (Jl, "jl", "text/plain", "code"),
    (Jmd, "jmd", "text/plain", "code"),
    (Sty, "sty", "text/plain", "code"),
    (Cls, "cls", "text/plain", "code"),
    (Bbx, "bbx", "text/plain", "code"),
    (Cbx, "cbx", "text/plain", "code"),
    (Tex, "tex", "text/plain", "code"),
    (Ltx, "ltx", "text/plain", "code"),
    (Ctx, "ctx", "text/plain", "code"),
    (Bib, "bib", "text/plain", "code"),
    (Less, "less", "text/plain", "code"),
    (Log, "log", "text/plain", "code"),
    (Lua, "lua", "text/plain", "code"),
    (Mak, "mak", "text/plain", "code"),
    (Mk, "mk", "text/plain", "code"),
    (Mkd, "mkd", "text/plain", "code"),
    (Mdwn, "mdwn", "text/plain", "code"),
    (Mdown, "mdown", "text/plain", "code"),
    (Markdown, "markdown", "text/plain", "code"),
    (Markdn, "markdn", "text/plain", "code"),
    (Mdtxt, "mdtxt", "text/plain", "code"),
    (Mdtext, "mdtext", "text/plain", "code"),
    (Workbook, "workbook", "text/plain", "code"),
    (M, "m", "text/plain", "code"),
    (Mm, "mm", "text/plain", "code"),
    (Pl, "pl", "text/plain", "code"),
    (Pm, "pm", "text/plain", "code"),
    (Pod, "pod", "text/plain", "code"),
    (T, "t", "text/plain", "code"),
    (Psgi, "psgi", "text/plain", "code"),
    (Raku, "raku", "text/plain", "code"),
    (Rakumod, "rakumod", "text/plain", "code"),
    (Rakutest, "rakutest", "text/plain", "code"),
    (Rakudoc, "rakudoc", "text/plain", "code"),
    (Nqp, "nqp", "text/plain", "code"),
    (P6, "p6", "text/plain", "code"),
    (Pl6, "pl6", "text/plain", "code"),
    (Pm6, "pm6", "text/plain", "code"),
    (Php, "php", "text/plain", "code"),
    (Php4, "php4", "text/plain", "code"),
    (Php5, "php5", "text/plain", "code"),
    (Phtml, "phtml", "text/plain", "code"),
    (Ctp, "ctp", "text/plain", "code"),
    (Ps1, "ps1", "text/plain", "code"),
    (Psm1, "psm1", "text/plain", "code"),
    (Psd1, "psd1", "text/plain", "code"),
    (Pssc, "pssc", "text/plain", "code"),
    (Psrc, "psrc", "text/plain", "code"),
    (Py, "py", "text/plain", "code"),
    (Rpy, "rpy", "text/plain", "code"),
    (Pyw, "pyw", "text/plain", "code"),
    (Cpy, "cpy", "text/plain", "code"),
    (Gyp, "gyp", "text/plain", "code"),
    (Gypi, "gypi", "text/plain", "code"),
    (Pyi, "pyi", "text/plain", "code"),
    (Ipy, "ipy", "text/plain", "code"),
    (Pyt, "pyt", "text/plain", "code"),
    (R, "r", "text/plain", "code"),
    (Rhistory, "rhistory", "text/plain", "code"),
    (Rprofile, "rprofile", "text/plain", "code"),
    (Rt, "rt", "text/plain", "code"),
    (Cshtml, "cshtml", "text/plain", "code"),
    (Razor, "razor", "text/plain", "code"),
    (Rb, "rb", "text/plain", "code"),
    (Rbx, "rbx", "text/plain", "code"),
    (Rjs, "rjs", "text/plain", "code"),
    (Gemspec, "gemspec", "text/plain", "code"),
    (Rake, "rake", "text/plain", "code"),
    (Ru, "ru", "text/plain", "code"),
    (Erb, "erb", "text/plain", "code"),
    (Podspec, "podspec", "text/plain", "code"),
    (Rbi, "rbi", "text/plain", "code"),
    (Rs, "rs", "text/plain", "code"),
    (Scss, "scss", "text/plain", "code"),
    (Shader, "shader", "text/plain", "code"),
    (Sh, "sh", "text/plain", "code"),
    (Bash, "bash", "text/plain", "code"),
    (Bashrc, "bashrc", "text/plain", "code"),
    (BashAliases, "bash_aliases", "text/plain", "code"),
    (BashProfile, "bash_profile", "text/plain", "code"),
    (BashLogin, "bash_login", "text/plain", "code"),
    (Ebuild, "ebuild", "text/plain", "code"),
    (Eclass, "eclass", "text/plain", "code"),
    (Profile, "profile", "text/plain", "code"),
    (BashLogout, "bash_logout", "text/plain", "code"),
    (Xprofile, "xprofile", "text/plain", "code"),
    (Xsession, "xsession", "text/plain", "code"),
    (Xsessionrc, "xsessionrc", "text/plain", "code"),
    (Zsh, "zsh", "text/plain", "code"),
    (Zshrc, "zshrc", "text/plain", "code"),
    (Zprofile, "zprofile", "text/plain", "code"),
    (Zlogin, "zlogin", "text/plain", "code"),
    (Zlogout, "zlogout", "text/plain", "code"),
    (Zshenv, "zshenv", "text/plain", "code"),
    (ZshTheme, "zsh-theme", "text/plain", "code"),
    (Fish, "fish", "text/plain", "code"),
    (Ksh, "ksh", "text/plain", "code"),
    (Csh, "csh", "text/plain", "code"),
    (Cshrc, "cshrc", "text/plain", "code"),
    (Tcshrc, "tcshrc", "text/plain", "code"),
    (Yashrc, "yashrc", "text/plain", "code"),
    (YashProfile, "yash_profile", "text/plain", "code"),
    (Sql, "sql", "text/plain", "code"),
    (Dsql, "dsql", "text/plain", "code"),
    (Swift, "swift", "text/plain", "code"),
    (Ts, "ts", "text/plain", "code"),
    (Cts, "cts", "text/plain", "code"),
    (Mts, "mts", "text/plain", "code"),
    (Tsx, "tsx", "text/plain", "code"),
    (Tsbuildinfo, "tsbuildinfo", "text/plain", "code"),
    (Xml, "xml", "text/plain", "code"),
    (Xsd, "xsd", "text/plain", "code"),
    (Ascx, "ascx", "text/plain", "code"),
    (Atom, "atom", "text/plain", "code"),
    (Axml, "axml", "text/plain", "code"),
    (Axaml, "axaml", "text/plain", "code"),
    (Bpmn, "bpmn", "text/plain", "code"),
    (Cpt, "cpt", "text/plain", "code"),
    (Csl, "csl", "text/plain", "code"),
    (Csproj, "csproj", "text/plain", "code"),
    (CsprojUser, "csproj.user", "text/plain", "code"),
    (Dita, "dita", "text/plain", "code"),
    (Ditamap, "ditamap", "text/plain", "code"),
    (Dtd, "dtd", "text/plain", "code"),
    (Ent, "ent", "text/plain", "code"),
    (Mod, "mod", "text/plain", "code"),
    (Dtml, "dtml", "text/plain", "code"),
    (Fsproj, "fsproj", "text/plain", "code"),
    (Fxml, "fxml", "text/plain", "code"),
    (Iml, "iml", "text/plain", "code"),
    (Isml, "isml", "text/plain", "code"),
    (Jmx, "jmx", "text/plain", "code"),
    (Launch, "launch", "text/plain", "code"),
    (Menu, "menu", "text/plain", "code"),
    (Mxml, "mxml", "text/plain", "code"),
    (Nuspec, "nuspec", "text/plain", "code"),
    (Opml, "opml", "text/plain", "code"),
    (Owl, "owl", "text/plain", "code"),
    (Proj, "proj", "text/plain", "code"),
    (Props, "props", "text/plain", "code"),
    (Pt, "pt", "text/plain", "code"),
    (Publishsettings, "publishsettings", "text/plain", "code"),
    (Pubxml, "pubxml", "text/plain", "code"),
    (PubxmlUser, "pubxml.user", "text/plain", "code"),
    (Rbxlx, "rbxlx", "text/plain", "code"),
    (Rbxmx, "rbxmx", "text/plain", "code"),
    (Rdf, "rdf", "text/plain", "code"),
    (Rng, "rng", "text/plain", "code"),
    (Rss, "rss", "text/plain", "code"),
    (Shproj, "shproj", "text/plain", "code"),
    (Storyboard, "storyboard", "text/plain", "code"),
    (Targets, "targets", "text/plain", "code"),
    (Tld, "tld", "text/plain", "code"),
    (Tmx, "tmx", "text/plain", "code"),
    (Vbproj, "vbproj", "text/plain", "code"),
    (VbprojUser, "vbproj.user", "text/plain", "code"),
    (Vcxproj, "vcxproj", "text/plain", "code"),
    (VcxprojFilters, "vcxproj.filters", "text/plain", "code"),
    (Wsdl, "wsdl", "text/plain", "code"),
    (Wxi, "wxi", "text/plain", "code"),
    (Wxl, "wxl", "text/plain", "code"),
    (Wxs, "wxs", "text/plain", "code"),
    (Xaml, "xaml", "text/plain", "code"),
    (Xbl, "xbl", "text/plain", "code"),
    (Xib, "xib", "text/plain", "code"),
    (Xlf, "xlf", "text/plain", "code"),
    (Xliff, "xliff", "text/plain", "code"),
    (Xpdl, "xpdl", "text/plain", "code"),
    (Xul, "xul", "text/plain", "code"),
    (Xoml, "xoml", "text/plain", "code"),
    (Xsl, "xsl", "text/plain", "code"),
    (Xslt, "xslt", "text/plain", "code"),
    (Yaml, "yaml", "text/plain", "code"),
    (Yml, "yml", "text/plain", "code"),
    (Eyaml, "eyaml", "text/plain", "code"),
    (Eyml, "eyml", "text/plain", "code"),
    (Cff, "cff", "text/plain", "code"),
    (YamlTmlanguage, "yaml-tmlanguage", "text/plain", "code"),
    (
        YamlTmpreferences,
        "yaml-tmpreferences",
        "text/plain",
        "code"
    ),
    (YamlTmtheme, "yaml-tmtheme", "text/plain", "code"),
    (Winget, "winget", "text/plain", "code"),
    (Txt, "txt", "text/plain", "code"),
    (Csv, "csv", "text/plain", "code"),
    (Tsv, "tsv", "text/plain", "code"),
    // } Code block
    // images
    (Jpeg, "jpeg", "image/jpeg", "image"),
    (Jpg, "jpg", "image/jpeg", "image"),
    (Png, "png", "image/png", "image"),
    (Gif, "gif", "image/gif", "image"),
    (Svg, "svg", "image/svg+xml", "image"),
    (Webp, "webp", "image/webp", "image"),
    (Avif, "avif", "image/avif", "image"),
    (Bmp, "bmp", "image/bmp", "image"),
    (Ico, "ico", "image/x-icon", "image"),
    (Tiff, "tiff", "image/tiff", "image"),
    (Tif, "tif", "image/tiff", "image"),
    (Heic, "heic", "image/heic", "image"),
    (Heif, "heif", "image/heif", "image"),
    // NOT SUPPORTED BLOCKS

    // Archives and compressed files
    (Tar, "tar", "application/x-tar", "archive"),
    (TarGz, "tar.gz", "application/gzip", "archive"),
    (Tgz, "tgz", "application/gzip", "archive"),
    (Gz, "gz", "application/gzip", "archive"),
    (Bz2, "bz2", "application/x-bzip2", "archive"),
    (TarBz2, "tar.bz2", "application/x-bzip2", "archive"),
    (Tbz2, "tbz2", "application/x-bzip2", "archive"),
    (Z, "z", "application/x-compress", "archive"),
    (TarZ, "tar.z", "application/x-compress", "archive"),
    (Lz, "lz", "application/x-lzip", "archive"),
    (TarLz, "tar.lz", "application/x-lzip", "archive"),
    (Xz, "xz", "application/x-xz", "archive"),
    (TarXz, "tar.xz", "application/x-xz", "archive"),
    (Txz, "txz", "application/x-xz", "archive"),
    (Lzma, "lzma", "application/x-lzma", "archive"),
    (TarLzma, "tar.lzma", "application/x-lzma", "archive"),
    (Rar, "rar", "application/vnd.rar", "archive"),
    (SevenZ, "7z", "application/x-7z-compressed", "archive"),
    (Zst, "zst", "application/zstd", "archive"),
    (TarZst, "tar.zst", "application/zstd", "archive"),
    (Tzst, "tzst", "application/zstd", "archive"),
    (Zip, "zip", "application/zip", "archive"),
    // Executable files
    (Exe, "exe", "application/x-msdownload", "executable"),
    (Msi, "msi", "application/x-msi", "executable"),
    (Dll, "dll", "application/x-msdownload", "executable"),
    (Bat, "bat", "application/x-bat", "executable"),
    (Cmd, "cmd", "application/x-cmd", "executable"),
    (Com, "com", "application/x-msdownload", "executable"),
    (
        AppImage,
        "appimage",
        "application/x-executable",
        "executable"
    ),
    (App, "app", "application/x-executable", "executable"),
    (Bin, "bin", "application/octet-stream", "executable"),
    (
        Deb,
        "deb",
        "application/vnd.debian.binary-package",
        "executable"
    ),
    (Rpm, "rpm", "application/x-rpm", "executable"),
    (
        Apk,
        "apk",
        "application/vnd.android.package-archive",
        "executable"
    ),
    (Dmg, "dmg", "application/x-apple-diskimage", "executable"),
    (
        Pkg,
        "pkg",
        "application/vnd.apple.installer+xml",
        "executable"
    ),
    (Crx, "crx", "application/x-chrome-extension", "executable"),
    (Xpi, "xpi", "application/x-xpinstall", "executable"),
    // Audio files
    (Mp3, "mp3", "audio/mpeg", "audio"),
    (Wav, "wav", "audio/wav", "audio"),
    (Ogg, "ogg", "audio/ogg", "audio"),
    (Flac, "flac", "audio/flac", "audio"),
    (Aac, "aac", "audio/aac", "audio"),
    (M4a, "m4a", "audio/mp4", "audio"),
    (Wma, "wma", "audio/x-ms-wma", "audio"),
    (Mid, "mid", "audio/midi", "audio"),
    (Midi, "midi", "audio/midi", "audio"),
    // Video files
    (Mp4, "mp4", "video/mp4", "video"),
    (Mkv, "mkv", "video/x-matroska", "video"),
    (Webm, "webm", "video/webm", "video"),
    (Avi, "avi", "video/x-msvideo", "video"),
    (Mov, "mov", "video/quicktime", "video"),
    (Wmv, "wmv", "video/x-ms-wmv", "video"),
    (Mpg, "mpg", "video/mpeg", "video"),
    (Mpeg, "mpeg", "video/mpeg", "video"),
    (M4v, "m4v", "video/mp4", "video"),
    (Flv, "flv", "video/x-flv", "video"),
    (F4v, "f4v", "video/mp4", "video"),
    (ThreeGp, "3gp", "video/3gpp", "video"),
    // Font files
    (Ttf, "ttf", "font/ttf", "font"),
    (Otf, "otf", "font/otf", "font"),
    (Woff, "woff", "font/woff", "font"),
    (Woff2, "woff2", "font/woff2", "font"),
    (Eot, "eot", "application/vnd.ms-fontobject", "font"),
    // Document formats
    (Rtf, "rtf", "application/rtf", "document"),
    (
        Odt,
        "odt",
        "application/vnd.oasis.opendocument.text",
        "document"
    ),
    (
        Ods,
        "ods",
        "application/vnd.oasis.opendocument.spreadsheet",
        "document"
    ),
    (
        Odp,
        "odp",
        "application/vnd.oasis.opendocument.presentation",
        "document"
    ),
    (
        Odg,
        "odg",
        "application/vnd.oasis.opendocument.graphics",
        "document"
    ),
    (
        Odf,
        "odf",
        "application/vnd.oasis.opendocument.formula",
        "document"
    ),
    (Epub, "epub", "application/epub+zip", "document"),
    (Mobi, "mobi", "application/x-mobipocket-ebook", "document"),
    (Azw, "azw", "application/vnd.amazon.ebook", "document"),
    (Azw3, "azw3", "application/vnd.amazon.ebook", "document"),
    (Djvu, "djvu", "image/vnd.djvu", "document"),
    (Xls, "xls", "application/vnd.ms-excel", "document"),
    (Ppt, "ppt", "application/vnd.ms-powerpoint", "document"),
    (Pptx, "pptx", "application/xml", "document"),
    (Xlsx, "xlsx", "application/xml", "document"),
    // Database files
    (Db, "db", "application/octet-stream", "database"),
    (Sqlite, "sqlite", "application/vnd.sqlite3", "database"),
    (Sqlite3, "sqlite3", "application/vnd.sqlite3", "database"),
    (Mdb, "mdb", "application/vnd.ms-access", "database"),
    (Accdb, "accdb", "application/vnd.ms-access", "database"),
    (Dbf, "dbf", "application/x-dbf", "database"),
    // Data and config files
    (Plist, "plist", "application/xml", "data"),
    (Toml, "toml", "application/toml", "data"),
    (Env, "env", "text/plain", "data"),
    (Dot, "dot", "text/vnd.graphviz", "data"),
    (Gv, "gv", "text/vnd.graphviz", "data"),
    (Torrent, "torrent", "application/x-bittorrent", "data"),
    (Ics, "ics", "text/calendar", "data"),
    (Vcf, "vcf", "text/vcard", "data"),
    // Vector graphics
    (Ai, "ai", "application/postscript", "vector"),
    (Eps, "eps", "application/postscript", "vector"),
    (Ps, "ps", "application/postscript", "vector"),
    (Dxf, "dxf", "image/vnd.dxf", "vector"),
    (Dwg, "dwg", "image/vnd.dwg", "vector"),
    // 3D files
    (Stl, "stl", "model/stl", "3d"),
    (Obj, "obj", "model/obj", "3d"),
    (Fbx, "fbx", "application/octet-stream", "3d"),
    (Blend, "blend", "application/x-blender", "3d"),
    (Dae, "dae", "model/vnd.collada+xml", "3d"),
    (ThreeDs, "3ds", "application/x-3ds", "3d"),
    (Gltf, "gltf", "model/gltf+json", "3d"),
    (Glb, "glb", "model/gltf-binary", "3d"),
    // Virtual machine and container files
    (Vhd, "vhd", "application/x-virtualbox-vhd", "vm"),
    (Vhdx, "vhdx", "application/x-virtualbox-vhdx", "vm"),
    (Vmdk, "vmdk", "application/x-vmdk", "vm"),
    (Ova, "ova", "application/x-virtualbox-ova", "vm"),
    (Ovf, "ovf", "application/x-virtualbox-ovf", "vm"),
    (Iso, "iso", "application/x-iso9660-image", "vm"),
    (Img, "img", "application/octet-stream", "vm"),
    // Miscellaneous
    (Swf, "swf", "application/x-shockwave-flash", "media"),
);
