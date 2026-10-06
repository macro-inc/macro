//! Languages we parse with tree-sitter: detection, grammars and queries.

use tree_sitter::Language;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Lang {
    Rust,
    TypeScript,
    Tsx,
    JavaScript,
    Python,
    Go,
    Json,
    Bash,
    Toml,
    Yaml,
    C,
    Cpp,
    Css,
    Html,
    Nix,
    Java,
    Ruby,
    Lua,
    Markdown,
    MarkdownInline,
    Sql,
}

impl Lang {
    pub const ALL: [Lang; 21] = [
        Lang::Rust,
        Lang::TypeScript,
        Lang::Tsx,
        Lang::JavaScript,
        Lang::Python,
        Lang::Go,
        Lang::Json,
        Lang::Bash,
        Lang::Toml,
        Lang::Yaml,
        Lang::C,
        Lang::Cpp,
        Lang::Css,
        Lang::Html,
        Lang::Nix,
        Lang::Java,
        Lang::Ruby,
        Lang::Lua,
        Lang::Markdown,
        Lang::MarkdownInline,
        Lang::Sql,
    ];

    /// Position in [`Lang::ALL`], which lists the languages in declaration order.
    pub fn index(self) -> usize {
        self as usize
    }

    /// Guess the language from a path's file name.
    pub fn from_path(path: &str) -> Option<Lang> {
        let name = path.rsplit('/').next().unwrap_or(path);
        let lower = name.to_ascii_lowercase();
        match lower.as_str() {
            "cargo.lock" | "poetry.lock" => return Some(Lang::Toml),
            "flake.lock" => return Some(Lang::Json),
            "makefile" | "justfile" | ".envrc" => return Some(Lang::Bash),
            ".bashrc" | ".zshrc" | ".profile" => return Some(Lang::Bash),
            _ => {}
        }
        let ext = lower.rsplit_once('.').map(|(_, e)| e)?;
        Some(match ext {
            "sql" => Lang::Sql,
            "rs" => Lang::Rust,
            "ts" | "mts" | "cts" => Lang::TypeScript,
            "tsx" => Lang::Tsx,
            "js" | "mjs" | "cjs" | "jsx" => Lang::JavaScript,
            "py" | "pyi" => Lang::Python,
            "go" => Lang::Go,
            "json" | "jsonc" | "json5" => Lang::Json,
            "sh" | "bash" | "zsh" => Lang::Bash,
            "toml" => Lang::Toml,
            "yaml" | "yml" => Lang::Yaml,
            "c" | "h" => Lang::C,
            "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => Lang::Cpp,
            "css" => Lang::Css,
            "html" | "htm" => Lang::Html,
            "nix" => Lang::Nix,
            "java" => Lang::Java,
            "rb" => Lang::Ruby,
            "lua" => Lang::Lua,
            "md" | "markdown" => Lang::Markdown,
            _ => return None,
        })
    }

    /// Look up a language by the name used in injections and code fences.
    pub fn from_name(name: &str) -> Option<Lang> {
        Some(match name.to_ascii_lowercase().as_str() {
            "sql" | "postgres" | "postgresql" => Lang::Sql,
            "rust" | "rs" => Lang::Rust,
            "typescript" | "ts" => Lang::TypeScript,
            "tsx" => Lang::Tsx,
            "javascript" | "js" | "jsx" => Lang::JavaScript,
            "python" | "py" => Lang::Python,
            "go" => Lang::Go,
            "json" => Lang::Json,
            "bash" | "sh" | "shell" | "zsh" => Lang::Bash,
            "toml" => Lang::Toml,
            "yaml" | "yml" => Lang::Yaml,
            "c" => Lang::C,
            "cpp" | "c++" => Lang::Cpp,
            "css" => Lang::Css,
            "html" => Lang::Html,
            "nix" => Lang::Nix,
            "java" => Lang::Java,
            "ruby" | "rb" => Lang::Ruby,
            "lua" => Lang::Lua,
            "markdown" | "md" => Lang::Markdown,
            "markdown_inline" => Lang::MarkdownInline,
            _ => return None,
        })
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Lang::Sql => "SQL",
            Lang::Rust => "Rust",
            Lang::TypeScript => "TypeScript",
            Lang::Tsx => "TSX",
            Lang::JavaScript => "JavaScript",
            Lang::Python => "Python",
            Lang::Go => "Go",
            Lang::Json => "JSON",
            Lang::Bash => "Shell",
            Lang::Toml => "TOML",
            Lang::Yaml => "YAML",
            Lang::C => "C",
            Lang::Cpp => "C++",
            Lang::Css => "CSS",
            Lang::Html => "HTML",
            Lang::Nix => "Nix",
            Lang::Java => "Java",
            Lang::Ruby => "Ruby",
            Lang::Lua => "Lua",
            Lang::Markdown | Lang::MarkdownInline => "Markdown",
        }
    }

    pub fn language(self) -> Language {
        match self {
            Lang::Sql => tree_sitter_sequel::LANGUAGE.into(),
            Lang::Rust => tree_sitter_rust::LANGUAGE.into(),
            Lang::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Lang::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Lang::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            Lang::Python => tree_sitter_python::LANGUAGE.into(),
            Lang::Go => tree_sitter_go::LANGUAGE.into(),
            Lang::Json => tree_sitter_json::LANGUAGE.into(),
            Lang::Bash => tree_sitter_bash::LANGUAGE.into(),
            Lang::Toml => tree_sitter_toml_ng::LANGUAGE.into(),
            Lang::Yaml => tree_sitter_yaml::LANGUAGE.into(),
            Lang::C => tree_sitter_c::LANGUAGE.into(),
            Lang::Cpp => tree_sitter_cpp::LANGUAGE.into(),
            Lang::Css => tree_sitter_css::LANGUAGE.into(),
            Lang::Html => tree_sitter_html::LANGUAGE.into(),
            Lang::Nix => tree_sitter_nix::LANGUAGE.into(),
            Lang::Java => tree_sitter_java::LANGUAGE.into(),
            Lang::Ruby => tree_sitter_ruby::LANGUAGE.into(),
            Lang::Lua => tree_sitter_lua::LANGUAGE.into(),
            Lang::Markdown => tree_sitter_md::LANGUAGE.into(),
            Lang::MarkdownInline => tree_sitter_md::INLINE_LANGUAGE.into(),
        }
    }

    /// Highlight, injection and locals queries.
    pub fn highlight_queries(self) -> (String, &'static str, &'static str) {
        let h = |q: &str| q.to_owned();
        match self {
            // The SQL grammar ships Lua-style numeric predicates; tree-sitter-highlight uses regex.
            Lang::Sql => (tree_sitter_sequel::HIGHLIGHTS_QUERY.replace("%d", "[0-9]"), "", ""),
            Lang::Rust => (h(tree_sitter_rust::HIGHLIGHTS_QUERY), tree_sitter_rust::INJECTIONS_QUERY, ""),
            // The TypeScript queries extend the JavaScript ones.
            Lang::TypeScript => (
                format!("{}\n{}", tree_sitter_typescript::HIGHLIGHTS_QUERY, tree_sitter_javascript::HIGHLIGHT_QUERY),
                tree_sitter_javascript::INJECTIONS_QUERY,
                tree_sitter_typescript::LOCALS_QUERY,
            ),
            Lang::Tsx => (
                format!(
                    "{}\n{}\n{}",
                    tree_sitter_typescript::HIGHLIGHTS_QUERY,
                    tree_sitter_javascript::JSX_HIGHLIGHT_QUERY,
                    tree_sitter_javascript::HIGHLIGHT_QUERY
                ),
                tree_sitter_javascript::INJECTIONS_QUERY,
                tree_sitter_typescript::LOCALS_QUERY,
            ),
            Lang::JavaScript => (
                format!("{}\n{}", tree_sitter_javascript::JSX_HIGHLIGHT_QUERY, tree_sitter_javascript::HIGHLIGHT_QUERY),
                tree_sitter_javascript::INJECTIONS_QUERY,
                tree_sitter_javascript::LOCALS_QUERY,
            ),
            Lang::Python => (h(tree_sitter_python::HIGHLIGHTS_QUERY), "", ""),
            Lang::Go => (h(tree_sitter_go::HIGHLIGHTS_QUERY), "", ""),
            Lang::Json => (h(tree_sitter_json::HIGHLIGHTS_QUERY), "", ""),
            Lang::Bash => (h(tree_sitter_bash::HIGHLIGHT_QUERY), "", ""),
            Lang::Toml => (h(tree_sitter_toml_ng::HIGHLIGHTS_QUERY), "", ""),
            Lang::Yaml => (h(tree_sitter_yaml::HIGHLIGHTS_QUERY), "", ""),
            Lang::C => (h(tree_sitter_c::HIGHLIGHT_QUERY), "", ""),
            Lang::Cpp => (format!("{}\n{}", tree_sitter_cpp::HIGHLIGHT_QUERY, tree_sitter_c::HIGHLIGHT_QUERY), "", ""),
            Lang::Css => (h(tree_sitter_css::HIGHLIGHTS_QUERY), "", ""),
            Lang::Html => (h(tree_sitter_html::HIGHLIGHTS_QUERY), tree_sitter_html::INJECTIONS_QUERY, ""),
            Lang::Nix => (h(tree_sitter_nix::HIGHLIGHTS_QUERY), tree_sitter_nix::INJECTIONS_QUERY, ""),
            Lang::Java => (h(tree_sitter_java::HIGHLIGHTS_QUERY), "", ""),
            Lang::Ruby => (h(tree_sitter_ruby::HIGHLIGHTS_QUERY), "", tree_sitter_ruby::LOCALS_QUERY),
            Lang::Lua => (h(tree_sitter_lua::HIGHLIGHTS_QUERY), tree_sitter_lua::INJECTIONS_QUERY, tree_sitter_lua::LOCALS_QUERY),
            Lang::Markdown => (h(tree_sitter_md::HIGHLIGHT_QUERY_BLOCK), tree_sitter_md::INJECTION_QUERY_BLOCK, ""),
            Lang::MarkdownInline => (h(tree_sitter_md::HIGHLIGHT_QUERY_INLINE), tree_sitter_md::INJECTION_QUERY_INLINE, ""),
        }
    }

    /// Tags query (definitions), for languages that ship one.
    pub fn tags_query(self) -> Option<String> {
        Some(match self {
            Lang::Rust => tree_sitter_rust::TAGS_QUERY.to_owned(),
            Lang::TypeScript | Lang::Tsx => {
                // TypeScript's query only adds TS-specific tags on top of JavaScript's.
                return Some(format!("{}\n{}", tree_sitter_typescript::TAGS_QUERY, tree_sitter_javascript::TAGS_QUERY));
            }
            Lang::JavaScript => tree_sitter_javascript::TAGS_QUERY.to_owned(),
            Lang::Python => tree_sitter_python::TAGS_QUERY.to_owned(),
            Lang::Go => tree_sitter_go::TAGS_QUERY.to_owned(),
            Lang::C => tree_sitter_c::TAGS_QUERY.to_owned(),
            Lang::Cpp => tree_sitter_cpp::TAGS_QUERY.to_owned(),
            Lang::Java => tree_sitter_java::TAGS_QUERY.to_owned(),
            Lang::Ruby => tree_sitter_ruby::TAGS_QUERY.to_owned(),
            Lang::Lua => tree_sitter_lua::TAGS_QUERY.to_owned(),
            _ => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_is_in_declaration_order() {
        for (i, lang) in Lang::ALL.iter().enumerate() {
            assert_eq!(lang.index(), i, "{lang:?}");
        }
    }

    #[test]
    fn detects_languages() {
        assert_eq!(Lang::from_path("crates/x/src/lib.rs"), Some(Lang::Rust));
        assert_eq!(Lang::from_path("web/App.tsx"), Some(Lang::Tsx));
        assert_eq!(Lang::from_path("Cargo.lock"), Some(Lang::Toml));
        assert_eq!(Lang::from_path("flake.lock"), Some(Lang::Json));
        assert_eq!(Lang::from_path("README"), None);
    }
}
