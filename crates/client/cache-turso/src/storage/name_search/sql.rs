use super::*;

pub(super) const RECORD_JOIN: &str = "CROSS JOIN records r INDEXED BY records_contacts_cover_idx ON r.__typename='GraphqlContact' AND r.id=substr(d.record_key,16)";
#[derive(Default)]
pub(super) struct Params {
    pub values: driver::Values,
}
impl Params {
    pub fn bind(&mut self, value: Value) -> String {
        self.values.push(value);
        format!("?{}", self.values.len())
    }
}
pub(super) enum Bounds {
    Equal(Vec<u8>),
    Prefix(Vec<u8>),
    All,
}
pub(super) struct Seed {
    pub attribute: &'static str,
    pub bounds: Bounds,
}
impl Seed {
    pub fn restriction(&self, p: &mut Params, alias: &str) -> String {
        let attr = p.bind(text(self.attribute));
        let mut sql = format!("{alias}.attribute={attr}");
        match &self.bounds {
            Bounds::Equal(value) => {
                let value = p.bind(Value::from_blob(value.clone()));
                sql.push_str(&format!(" AND {alias}.value={value}"));
            }
            Bounds::Prefix(value) => {
                let low = p.bind(Value::from_blob(value.clone()));
                sql.push_str(&format!(" AND {alias}.value>={low}"));
                if let Some(end) = prefix_end(value) {
                    let high = p.bind(Value::from_blob(end));
                    sql.push_str(&format!(" AND {alias}.value<{high}"));
                }
            }
            Bounds::All => {}
        }
        sql
    }
}
fn exists(p: &mut Params, seed: Seed) -> String {
    let restriction = seed.restriction(p, "f");
    format!(
        "EXISTS (SELECT 1 FROM exact_facts f INDEXED BY sqlite_autoindex_exact_facts_1 WHERE f.document_id=d.id AND {restriction})"
    )
}
pub(super) fn scope(p: &mut Params, read: &NameSearchRead<'_>, complete: bool) -> String {
    let profile = p.bind(text(people::PROFILE));
    let partition = p.bind(text(&people::partition(&read.request().scope.identity)));
    let mut sql = format!(
        "d.profile={profile} AND d.partition={partition} AND substr(d.record_key,1,15)='GraphqlContact:'"
    );
    if complete {
        sql.push_str(" AND d.state=0");
        let invalid = exists(
            p,
            Seed {
                attribute: names::INVALID_CONTEXT,
                bounds: Bounds::All,
            },
        );
        let hidden = exists(
            p,
            Seed {
                attribute: names::SECONDARY,
                bounds: Bounds::Equal(read.epoch().as_bytes().to_vec()),
            },
        );
        sql.push_str(&format!(" AND NOT {invalid} AND NOT {hidden}"));
        if !read.request().excluded.is_empty() {
            let values = read
                .request()
                .excluded
                .iter()
                .map(|id| p.bind(Value::from_blob(id.as_ref().as_bytes().to_vec())))
                .collect::<Vec<_>>()
                .join(",");
            sql.push_str(&format!(" AND NOT EXISTS (SELECT 1 FROM exact_facts excluded INDEXED BY sqlite_autoindex_exact_facts_1 WHERE excluded.document_id=d.id AND excluded.attribute='id' AND excluded.value IN ({values}))"));
        }
    }
    sql
}
pub(super) fn seeds(read: &NameSearchRead<'_>, stage: NameStage) -> Vec<Seed> {
    match (read.query(), stage) {
        (NameSearch::Identity(id), NameStage::Identity) => vec![Seed {
            attribute: "id",
            bounds: Bounds::Equal(id.as_ref().as_bytes().to_vec()),
        }],
        (NameSearch::EmailPrefix(value), NameStage::EmailPrefix) => vec![Seed {
            attribute: "email_lower",
            bounds: Bounds::Prefix(value.as_bytes().to_vec()),
        }],
        (NameSearch::Name(q), NameStage::ExactName) => vec![Seed {
            attribute: names::NAME,
            bounds: Bounds::Equal(q.normalized().as_bytes().to_vec()),
        }],
        (NameSearch::Name(q), NameStage::WordPrefix) => q
            .words()
            .map(|word| Seed {
                attribute: names::WORD,
                bounds: Bounds::Prefix(word.as_bytes().to_vec()),
            })
            .collect(),
        (_, NameStage::Browse) => vec![Seed {
            attribute: names::DEFAULT_RANK,
            bounds: Bounds::All,
        }],
        (_, NameStage::Contains) => vec![Seed {
            attribute: names::NAME,
            bounds: Bounds::All,
        }],
        _ => vec![],
    }
}
pub(super) fn matches(p: &mut Params, read: &NameSearchRead<'_>, stage: NameStage) -> String {
    match (read.query(), stage) {
        (_, NameStage::Browse) => "1".into(),
        (NameSearch::Name(q), NameStage::WordPrefix) => {
            let words = q
                .words()
                .map(|word| {
                    exists(
                        p,
                        Seed {
                            attribute: names::WORD,
                            bounds: Bounds::Prefix(word.as_bytes().to_vec()),
                        },
                    )
                })
                .collect::<Vec<_>>();
            if words.is_empty() {
                return "0".into();
            }
            let overflow = exists(
                p,
                Seed {
                    attribute: names::WORD_OVERFLOW,
                    bounds: Bounds::Equal(b"1".to_vec()),
                },
            );
            format!("(({}) OR {overflow})", words.join(" AND "))
        }
        (NameSearch::Name(q), NameStage::Contains) => {
            let parts = q
                .normalized()
                .split_whitespace()
                .map(|term| {
                    let mut like = "%".to_owned();
                    for c in term.chars() {
                        if matches!(c, '%' | '_' | '\\') {
                            like.push('\\');
                        }
                        like.push(c);
                    }
                    like.push('%');
                    let pattern = p.bind(text(&like));
                    format!("CAST(f.value AS TEXT) LIKE {pattern} ESCAPE '\\'")
                })
                .collect::<Vec<_>>();
            if parts.is_empty() {
                return "0".into();
            }
            format!(
                "EXISTS (SELECT 1 FROM exact_facts f INDEXED BY sqlite_autoindex_exact_facts_1 WHERE f.document_id=d.id AND f.attribute='{}' AND {})",
                names::NAME,
                parts.join(" AND ")
            )
        }
        _ => seeds(read, stage)
            .into_iter()
            .next()
            .map(|seed| exists(p, seed))
            .unwrap_or_else(|| "0".into()),
    }
}
pub(super) fn candidate(
    read: &NameSearchRead<'_>,
    stage: Option<NameStage>,
    seed: &Seed,
    exclude_overflow: bool,
) -> (String, driver::Values) {
    let mut p = Params::default();
    let restriction = seed.restriction(&mut p, "seed");
    let scope = scope(&mut p, read, true);
    // Seek predicates already prove the seed term. In particular contains must
    // filter its covering name row before loading the record, not point-probe
    // the same name again for every document in the directory.
    let matching = seed_filter(&mut p, read, stage, seed);
    let overflow = if exclude_overflow {
        format!(
            " AND NOT {}",
            exists(
                &mut p,
                Seed {
                    attribute: names::WORD_OVERFLOW,
                    bounds: Bounds::Equal(b"1".to_vec())
                }
            )
        )
    } else {
        String::new()
    };
    (
        format!(
            "SELECT r.__typename,r.id,r.value FROM exact_facts seed INDEXED BY exact_facts_lookup_idx CROSS JOIN index_documents d ON d.id=seed.document_id {RECORD_JOIN} WHERE {restriction} AND {scope} AND {matching}{overflow}"
        ),
        p.values,
    )
}

pub(super) fn seed_filter(
    p: &mut Params,
    read: &NameSearchRead<'_>,
    stage: Option<NameStage>,
    seed: &Seed,
) -> String {
    match (stage, read.query(), seed.attribute, &seed.bounds) {
        (Some(NameStage::Contains), NameSearch::Name(q), names::NAME, _) => q
            .normalized()
            .split_whitespace()
            .map(|term| {
                let mut like = "%".to_owned();
                for c in term.chars() {
                    if matches!(c, '%' | '_' | '\\') {
                        like.push('\\');
                    }
                    like.push(c);
                }
                like.push('%');
                let pattern = p.bind(text(&like));
                format!("CAST(seed.value AS TEXT) LIKE {pattern} ESCAPE '\\'")
            })
            .collect::<Vec<_>>()
            .join(" AND "),
        (Some(NameStage::WordPrefix), NameSearch::Name(q), names::WORD, Bounds::Prefix(prefix)) => {
            let rest = q
                .words()
                .filter(|word| word.as_bytes() != prefix)
                .map(|word| {
                    exists(
                        p,
                        Seed {
                            attribute: names::WORD,
                            bounds: Bounds::Prefix(word.as_bytes().to_vec()),
                        },
                    )
                })
                .collect::<Vec<_>>();
            if rest.is_empty() {
                "1".into()
            } else {
                rest.join(" AND ")
            }
        }
        (Some(NameStage::WordPrefix), _, names::WORD_OVERFLOW, _) => "1".into(),
        (
            Some(
                NameStage::ExactName
                | NameStage::EmailPrefix
                | NameStage::Identity
                | NameStage::Browse,
            ),
            _,
            _,
            _,
        )
        | (None, _, _, _) => "1".into(),
        (Some(stage), _, _, _) => matches(p, read, stage),
    }
}
