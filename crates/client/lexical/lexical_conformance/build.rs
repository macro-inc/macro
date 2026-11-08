use std::{collections::BTreeSet, env, fs, path::PathBuf};
use syn::{BinOp, Expr, ExprBinary, ExprMatch, ItemFn, Lit, Pat, visit::Visit};

struct DispatchNames {
    parameter: &'static str,
    prefix: &'static str,
    caret: bool,
    function: &'static str,
    names: BTreeSet<String>,
}

impl DispatchNames {
    fn pattern(&mut self, pattern: &Pat) {
        match pattern {
            Pat::Lit(value) => {
                if let Lit::Str(value) = &value.lit {
                    let name = value.value();
                    let prefix = if self.caret && name.starts_with('$') {
                        "lexical."
                    } else {
                        self.prefix
                    };
                    self.names.insert(format!("{prefix}{name}"));
                }
            }
            Pat::Or(pattern) => {
                for case in &pattern.cases {
                    self.pattern(case);
                }
            }
            _ => {}
        }
    }
}

impl<'ast> Visit<'ast> for DispatchNames {
    fn visit_item_fn(&mut self, function: &'ast ItemFn) {
        if function.sig.ident == self.function {
            syn::visit::visit_item_fn(self, function);
        }
    }

    fn visit_expr_binary(&mut self, expression: &'ast ExprBinary) {
        if matches!(expression.op, BinOp::Eq(_) | BinOp::Ne(_)) {
            for (left, right) in [
                (&expression.left, &expression.right),
                (&expression.right, &expression.left),
            ] {
                if let Expr::Path(path) = left.as_ref()
                    && path.path.is_ident(self.parameter)
                    && let Expr::Lit(value) = right.as_ref()
                {
                    self.pattern(&Pat::Lit(value.clone()));
                }
            }
        }
        syn::visit::visit_expr_binary(self, expression);
    }

    fn visit_expr_match(&mut self, expression: &'ast ExprMatch) {
        if let Expr::Path(path) = expression.expr.as_ref()
            && path.path.is_ident(self.parameter)
        {
            for arm in &expression.arms {
                self.pattern(&arm.pat);
            }
        }
        syn::visit::visit_expr_match(self, expression);
    }
}

fn main() -> Result<(), std::io::Error> {
    let mut names = BTreeSet::new();
    for (file, function, parameter, prefix, caret) in [
        ("lexical", "call", "name", "", false),
        ("nodes", "call", "method", "LexicalNode.", false),
        ("selection", "call", "method", "Selection.", false),
        ("caret", "call", "name", "Caret.", true),
        ("properties", "get", "name", "get:", false),
        ("properties/node", "get", "name", "get:", false),
        ("rich", "call", "name", "", false),
        ("rich", "link_method", "method", "LexicalNode.", false),
        ("markdown", "call", "short", "@lexical/markdown.", false),
    ] {
        let path = format!("src/api/{file}.rs");
        println!("cargo:rerun-if-changed={path}");
        let source = syn::parse_file(&fs::read_to_string(path)?).map_err(std::io::Error::other)?;
        let mut visitor = DispatchNames {
            parameter,
            prefix,
            caret,
            function,
            names: BTreeSet::new(),
        };
        visitor.visit_file(&source);
        names.extend(visitor.names);
    }
    let output = PathBuf::from(
        env::var_os("OUT_DIR").ok_or_else(|| std::io::Error::other("missing OUT_DIR"))?,
    );
    let names = names.into_iter().collect::<Vec<_>>();
    fs::write(
        output.join("api_index.rs"),
        format!("const API_INDEX: &[&str] = &{names:?};\n"),
    )?;
    Ok(())
}
