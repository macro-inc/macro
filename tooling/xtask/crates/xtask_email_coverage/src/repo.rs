//! Reads and parses the repository's Rust sources, and resolves a path
//! written in one module (`super::x::router`, `email::inbound::y`) to the file
//! that declares the item.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use rootcause::prelude::*;
use syn::{Item, UseTree};

/// Directories that hold workspace crates, searched for `<dir>/<crate name>`.
const CRATE_PARENTS: [&str; 2] = ["crates", "services"];

/// How many `use` re-exports a path may pass through before it is a cycle.
const MAX_IMPORT_HOPS: u8 = 8;

/// A line of a repository file, printed as `path:line`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Loc {
    /// Path relative to the repository root.
    pub(crate) file: String,
    pub(crate) line: usize,
}

impl Loc {
    pub(crate) fn new(file: &str, span: proc_macro2::Span) -> Self {
        Self {
            file: file.to_owned(),
            line: span.start().line,
        }
    }
}

impl fmt::Display for Loc {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.file, self.line)
    }
}

/// One module of a crate: its file and its place in the crate's module tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Module {
    /// File that holds the module, relative to the repository root.
    pub(crate) file: String,
    /// The crate's `src` directory, relative to the repository root.
    crate_src: String,
    /// Module names from the crate root down to this module.
    path: Vec<String>,
}

/// The repository's sources, parsed on first use.
pub(crate) struct Repo {
    root: PathBuf,
    parsed: RefCell<BTreeMap<String, Rc<syn::File>>>,
}

impl Repo {
    pub(crate) fn new(root: &Path) -> Self {
        Self {
            root: root.to_owned(),
            parsed: RefCell::new(BTreeMap::new()),
        }
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn is_file(&self, file: &str) -> bool {
        self.root.join(file).is_file()
    }

    pub(crate) fn read(&self, file: &str) -> Result<String, Report> {
        Ok(std::fs::read_to_string(self.root.join(file))
            .context(format!("could not read {file}"))?)
    }

    pub(crate) fn parse(&self, file: &str) -> Result<Rc<syn::File>, Report> {
        if let Some(parsed) = self.parsed.borrow().get(file) {
            return Ok(parsed.clone());
        }

        let text = self.read(file)?;
        let parsed = syn::parse_file(&text)
            .map_err(|error| report!("{}: {error}", Loc::new(file, error.span())))?;
        let parsed = Rc::new(parsed);
        self.parsed
            .borrow_mut()
            .insert(file.to_owned(), parsed.clone());
        Ok(parsed)
    }

    /// The module a source file holds.
    pub(crate) fn module_of(&self, file: &str) -> Result<Module, Report> {
        let crate_dir = Path::new(file)
            .ancestors()
            .skip(1)
            .find(|dir| self.root.join(dir).join("Cargo.toml").is_file())
            .ok_or_else(|| report!("{file} is not inside a crate"))?;
        let crate_src = crate_dir.join("src");
        let in_crate = Path::new(file)
            .strip_prefix(&crate_src)
            .map_err(|_| report!("{file} is not under its crate's src directory"))?;

        let mut path: Vec<String> = in_crate
            .with_extension("")
            .components()
            .map(|part| part.as_os_str().to_string_lossy().into_owned())
            .collect();
        let is_crate_root = matches!(path.as_slice(), [only] if only == "lib" || only == "main");
        if is_crate_root || path.last().is_some_and(|last| last == "mod") {
            path.pop();
        }

        Ok(Module {
            file: file.to_owned(),
            crate_src: crate_src.to_string_lossy().into_owned(),
            path,
        })
    }

    /// The module at `path` in the crate whose sources are in `crate_src`.
    fn module_at(&self, crate_src: &str, path: &[String]) -> Option<Module> {
        let files = if path.is_empty() {
            [
                format!("{crate_src}/lib.rs"),
                format!("{crate_src}/main.rs"),
            ]
        } else {
            let joined = path.join("/");
            [
                format!("{crate_src}/{joined}.rs"),
                format!("{crate_src}/{joined}/mod.rs"),
            ]
        };

        let file = files.into_iter().find(|file| self.is_file(file))?;
        Some(Module {
            file,
            crate_src: crate_src.to_owned(),
            path: path.to_owned(),
        })
    }

    /// Finds the item that `segments`, written in module `from`, names.
    /// Answers the module that declares it and the item's own name there.
    pub(crate) fn resolve(
        &self,
        from: &Module,
        segments: &[String],
        loc: &Loc,
    ) -> Result<(Module, String), Report> {
        self.resolve_within(from, segments, loc, MAX_IMPORT_HOPS)
    }

    fn resolve_within(
        &self,
        from: &Module,
        segments: &[String],
        loc: &Loc,
        hops_left: u8,
    ) -> Result<(Module, String), Report> {
        let written = segments.join("::");
        let Some(hops_left) = hops_left.checked_sub(1) else {
            bail!("{loc}: `{written}` goes through too many re-exports to follow");
        };
        let Some((name, qualifier)) = segments.split_last() else {
            bail!("{loc}: empty path");
        };
        let file = self.parse(&from.file)?;
        let imports = use_paths(&file);

        // A bare name is declared here or imported here.
        let Some((first, middle)) = qualifier.split_first() else {
            if declares(&file.items, name) {
                return Ok((from.clone(), name.clone()));
            }
            let Some(imported) = imports.get(name) else {
                bail!(
                    "{loc}: `{name}` is neither declared nor imported by name in {}",
                    from.file
                );
            };
            return self.resolve_within(from, imported, loc, hops_left);
        };

        // The qualifier's first segment decides where the path starts: this
        // crate's root, this module, a parent, a child module, an import, or
        // another crate.
        let mut crate_src = from.crate_src.clone();
        let mut module_path = from.path.clone();
        let mut middle = middle;
        match first.as_str() {
            "crate" => module_path.clear(),
            "self" => {}
            "super" => {
                let mut levels = 1;
                while let Some((next, rest)) = middle.split_first()
                    && next == "super"
                {
                    levels += 1;
                    middle = rest;
                }
                for _ in 0..levels {
                    if module_path.pop().is_none() {
                        bail!("{loc}: `{written}` climbs above the crate root");
                    }
                }
            }
            child if declares_module(&file.items, child) => module_path.push(child.to_owned()),
            imported if imports.contains_key(imported) => {
                let mut full = imports[imported].clone();
                full.extend_from_slice(middle);
                full.push(name.clone());
                return self.resolve_within(from, &full, loc, hops_left);
            }
            other_crate => {
                crate_src = self.crate_src(other_crate).ok_or_else(|| {
                    report!(
                        "{loc}: cannot resolve `{written}`: `{other_crate}` is not a module of \
                         {}, an import, or a crate under crates/ or services/",
                        from.file
                    )
                })?;
                module_path.clear();
            }
        }
        module_path.extend_from_slice(middle);

        let module = self.module_at(&crate_src, &module_path).ok_or_else(|| {
            report!(
                "{loc}: cannot resolve `{written}`: no module file for `{}` under {crate_src}",
                module_path.join("::")
            )
        })?;
        let target = self.parse(&module.file)?;
        if declares(&target.items, name) {
            return Ok((module, name.clone()));
        }

        // The module may re-export the item from elsewhere.
        match use_paths(&target).get(name) {
            Some(imported) => self.resolve_within(&module, imported, loc, hops_left),
            None => bail!(
                "{loc}: cannot resolve `{written}`: {} declares no `{name}`",
                module.file
            ),
        }
    }

    fn crate_src(&self, crate_name: &str) -> Option<String> {
        CRATE_PARENTS
            .iter()
            .map(|parent| format!("{parent}/{crate_name}/src"))
            .find(|src| self.is_file(&format!("{src}/lib.rs")))
    }

    /// Every file of the crate in `crate_dir` that its library compiles
    /// outside tests, found by following `mod` declarations from `lib.rs`.
    pub(crate) fn library_files(&self, crate_dir: &str) -> Result<Vec<String>, Report> {
        let crate_src = format!("{crate_dir}/src");
        let root = self
            .module_at(&crate_src, &[])
            .ok_or_else(|| report!("{crate_dir} has no src/lib.rs or src/main.rs"))?;

        let mut files = Vec::new();
        let mut pending = vec![root];
        while let Some(module) = pending.pop() {
            let file = self.parse(&module.file)?;
            let mut children = Vec::new();
            child_modules(&file.items, &module.path, &module.file, &mut children);
            for (path, loc) in children {
                let child = self
                    .module_at(&crate_src, &path)
                    .ok_or_else(|| report!("{loc}: no module file for `{}`", path.join("::")))?;
                pending.push(child);
            }
            files.push(module.file);
        }

        files.sort();
        Ok(files)
    }
}

/// Every name the file's `use` items bring into scope, with the path it
/// stands for. Glob imports name nothing, so they are not followed.
fn use_paths(file: &syn::File) -> BTreeMap<String, Vec<String>> {
    let mut found = BTreeMap::new();
    for item in &file.items {
        if let Item::Use(item) = item {
            collect_imports(&item.tree, &mut Vec::new(), &mut found);
        }
    }
    found
}

fn collect_imports(
    tree: &UseTree,
    prefix: &mut Vec<String>,
    found: &mut BTreeMap<String, Vec<String>>,
) {
    match tree {
        UseTree::Path(path) => {
            prefix.push(path.ident.to_string());
            collect_imports(&path.tree, prefix, found);
            prefix.pop();
        }
        UseTree::Name(name) => {
            let mut full = prefix.clone();
            full.push(name.ident.to_string());
            found.insert(name.ident.to_string(), full);
        }
        UseTree::Rename(rename) => {
            let mut full = prefix.clone();
            full.push(rename.ident.to_string());
            found.insert(rename.rename.to_string(), full);
        }
        UseTree::Group(group) => {
            for tree in &group.items {
                collect_imports(tree, prefix, found);
            }
        }
        UseTree::Glob(_) => {}
    }
}

fn declares(items: &[Item], name: &str) -> bool {
    items.iter().any(|item| match item {
        Item::Fn(item) => item.sig.ident == name,
        Item::Struct(item) => item.ident == name,
        Item::Enum(item) => item.ident == name,
        Item::Const(item) => item.ident == name,
        _ => false,
    })
}

fn declares_module(items: &[Item], name: &str) -> bool {
    items
        .iter()
        .any(|item| matches!(item, Item::Mod(item) if item.ident == name))
}

/// The module paths of every `mod name;` under `items` that is not test-only,
/// looking inside inline modules too.
fn child_modules(
    items: &[Item],
    parent: &[String],
    file: &str,
    found: &mut Vec<(Vec<String>, Loc)>,
) {
    for item in items {
        let Item::Mod(item) = item else { continue };
        if is_test_only(&item.attrs) {
            continue;
        }

        let mut path = parent.to_vec();
        path.push(item.ident.to_string());
        match &item.content {
            Some((_, inline)) => child_modules(inline, &path, file, found),
            None => found.push((path, Loc::new(file, item.ident.span()))),
        }
    }
}

/// Whether the attributes hold a `#[cfg(test)]`, alone or inside `all(...)`.
pub(crate) fn is_test_only(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|attr| {
        if !attr.path().is_ident("cfg") {
            return false;
        }
        let Ok(condition) = attr.parse_args::<proc_macro2::TokenStream>() else {
            return false;
        };
        let condition = condition.to_string();
        let names: Vec<&str> = condition
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .collect();
        names.contains(&"test") && !names.contains(&"not")
    })
}
