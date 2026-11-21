//! Filter, search-free reads of Soup and Mail: Soup filters, live views of them, deep windows, Mail filters and the input values they are built from.

use super::*;

impl Gen<'_> {
    pub(super) fn sort(&mut self) -> (&'static str, &'static str) {
        let sort = weighted(&mut self.rng, SORTS);
        let sort = SORTS
            .iter()
            .find(|(name, _)| *name == sort)
            .map_or("UPDATED_AT", |(name, _)| name);
        let direction = if self.rng.chance(0.65) { "DESC" } else { "ASC" };
        (sort, direction)
    }

    pub(super) fn soup_filter(&mut self) -> Value {
        let mut filters = Map::new();
        let mut included = Vec::new();
        for (name, ty) in PARTITIONS {
            let include = match *name {
                "documentFilter" | "chatFilter" | "projectFilter" => self.rng.chance(0.75),
                "channelFilter" => self.rng.chance(0.4),
                "emailFilter" => self.rng.chance(0.05),
                _ => self.rng.chance(0.03),
            };
            if !include {
                filters.insert((*name).to_owned(), exclusion(name));
                continue;
            }
            included.push(*name);
            if self.rng.chance(0.45) {
                self.filter_budget = 600;
                self.filter_chain = if self.rng.chance(0.04) {
                    self.rng.range(30, 70) as u8
                } else {
                    0
                };
                let value = self.input_named(ty, name, 0);
                filters.insert((*name).to_owned(), value);
            }
        }
        let mut request = Map::new();
        if self.rng.chance(0.08) {
            filters.insert("favoritesOnly".into(), Value::Bool(true));
        }
        let (sort, direction) = self.sort();
        request.insert("filters".into(), Value::Object(filters));
        request.insert("sortMethod".into(), sort.into());
        request.insert("sortDirection".into(), direction.into());
        let limit = *pick(&mut self.rng, LIMITS);
        request.insert("limit".into(), limit.into());
        if self.rng.chance(0.12) {
            request.insert("baseline".into(), self.baseline());
        }
        Value::Object(request)
    }

    /// A selective document filter whose few matches sit past the first
    /// candidate window of its sort attribute (64 candidates below a limit of
    /// 32), so the window must extend past the rows it rejects: random
    /// filters rarely fill a first window, so a lost extension would go
    /// unseen. Nothing is left incomplete, since an incomplete document in
    /// the query's partitions answers it as incomplete before a window runs.
    pub(super) fn deep_window(&mut self) {
        let mut docs: Vec<ItemSpec> = self
            .pools
            .core
            .iter()
            .filter(|spec| spec.typename == "GraphqlSoupDocument")
            .cloned()
            .collect();
        if docs.len() < 80 {
            return;
        }
        // Every core page, so each document is in the cache.
        for page in 0..self.pools.core.len().div_ceil(100) {
            self.hydrate_lane("core-entities", page);
        }
        docs.sort_by_key(|spec| std::cmp::Reverse(spec.time_ms));
        let mut filter: Option<Value> = None;
        for _ in 0..self.rng.range(1, 3) {
            let at = self.rng.range(70, docs.len() as u64 - 1) as usize;
            let literal = json!({ "literal": { "id": docs[at].id } });
            filter = Some(match filter {
                None => literal,
                Some(left) => json!({ "or": { "left": left, "right": literal } }),
            });
        }
        let mut filters = excluded(&["documentFilter"]);
        filters["documentFilter"] = filter.unwrap_or(Value::Null);
        // Sorts the bounded window serves; VIEWED_UPDATED answers unsupported.
        let sort = *pick(&mut self.rng, &["UPDATED_AT", "CREATED_AT"]);
        let limit = *pick(&mut self.rng, &[7u16, 20, 20, 31]);
        let request = json!({
            "filters": filters,
            "sortMethod": sort,
            "sortDirection": "DESC",
            "limit": limit,
        });
        self.push(Op::Filter { request, pages: 1 });
    }

    /// A live view op on one slot; reads mostly keep the slot's filter, so
    /// they test deltas, and sometimes replace it.
    pub(super) fn live(&mut self) {
        let slot = self.rng.below(LIVE_SLOTS as u64) as usize;
        let action = weighted(
            &mut self.rng,
            &[
                ("read", 30),
                ("read-since", 40),
                ("resume", 20),
                ("release", 10),
            ],
        )
        .to_owned();
        let request = match self.live[slot].clone() {
            Some(request) if action != "read" || self.rng.chance(0.6) => request,
            _ => {
                let mut request = self.soup_filter();
                if request.get("baseline").is_none() {
                    request["baseline"] = self.baseline();
                }
                request
            }
        };
        self.live[slot] = Some(request.clone());
        self.push(Op::Live {
            slot: slot as u8,
            action,
            request,
        });
    }

    pub(super) fn baseline(&mut self) -> Value {
        let keys = self.some_keys(12);
        Value::Array(
            keys.into_iter()
                .map(|key| {
                    let time = self.time();
                    json!({ "key": key, "sortTimestamp": rfc3339(time) })
                })
                .collect(),
        )
    }

    pub(super) fn mail_filter(&mut self) -> Value {
        let (sort, direction) = self.sort();
        let sort = if self.rng.chance(0.7) {
            "UPDATED_AT"
        } else {
            sort
        };
        let limit = *pick(&mut self.rng, LIMITS);
        if !self.mail_tabs.is_empty() && self.rng.chance(0.4) {
            let (_, tab) = pick(&mut self.rng, self.mail_tabs).clone();
            return json!({
                "filters": tab["filters"],
                "sortMethod": tab["sortMethod"],
                "sortDirection": direction,
                "limit": limit,
                "mail": { "view": tab["emailView"] },
            });
        }
        let mut filters = excluded(&["emailFilter"]);
        if self.rng.chance(0.6) {
            self.filter_budget = 600;
            let tree = self.input_named("GraphqlEmailExpr", "tree", 0);
            filters["emailFilter"] = json!({ "tree": tree });
        } else if self.rng.chance(0.5) {
            filters["emailFilter"] = json!({"tree": {"not": {"literal": {"threadId": NIL}}}});
        }
        let view = *pick(&mut self.rng, MAIL_VIEWS);
        json!({
            "filters": filters,
            "sortMethod": sort,
            "sortDirection": direction,
            "limit": limit,
            "mail": { "view": view },
        })
    }

    /// A random value of a GraphQL input type, drawn from the schema so every
    /// literal the filter grammar has can appear, with ids from this cache.
    pub(super) fn input_named(&mut self, ty: &str, field: &str, depth: u8) -> Value {
        self.filter_budget = self.filter_budget.saturating_sub(1);
        let schema = self.faker.schema();
        let Some(definition) = schema.types.get(ty) else {
            return self.scalar(ty, field);
        };
        match definition {
            ExtendedType::Enum(enumeration) => {
                let values: Vec<String> = enumeration
                    .values
                    .keys()
                    .map(|name| name.to_string())
                    .collect();
                Value::String(pick(&mut self.rng, &values).clone())
            }
            ExtendedType::InputObject(object) => {
                let fields: Vec<(Name, Type)> = object
                    .fields
                    .iter()
                    .map(|(name, field)| (name.clone(), field.ty.as_ref().clone()))
                    .collect();
                if object.directives.has("oneOf") {
                    // Mostly shallow; now and then nested deep, as a long saved filter is.
                    let deep = depth >= 2
                        && !(depth < 8 && self.filter_budget > 0 && self.rng.chance(0.25));
                    let choices: Vec<&(Name, Type)> = fields
                        .iter()
                        .filter(|(name, _)| !deep || !matches!(name.as_str(), "and" | "or" | "not"))
                        .collect();
                    let choices = if choices.is_empty() {
                        fields.iter().collect()
                    } else {
                        choices
                    };
                    let connectives: Vec<&(Name, Type)> = fields
                        .iter()
                        .filter(|(name, _)| matches!(name.as_str(), "and" | "or" | "not"))
                        .collect();
                    let choices = if self.filter_chain > 0 && !connectives.is_empty() {
                        self.filter_chain -= 1;
                        connectives
                    } else {
                        choices
                    };
                    let (name, ty) = (*pick(&mut self.rng, &choices)).clone();
                    let value = self.input_type(&ty, name.as_str(), depth + 1);
                    json!({ name.as_str(): value })
                } else {
                    let mut map = Map::new();
                    for (name, ty) in fields {
                        if ty.is_non_null() || self.rng.chance(0.35) {
                            let value = self.input_type(&ty, name.as_str(), depth + 1);
                            map.insert(name.to_string(), value);
                        }
                    }
                    Value::Object(map)
                }
            }
            _ => self.scalar(ty, field),
        }
    }

    pub(super) fn input_type(&mut self, ty: &Type, field: &str, depth: u8) -> Value {
        match ty {
            Type::Named(name) | Type::NonNullNamed(name) => {
                self.input_named(name.as_str(), field, depth)
            }
            Type::List(item) | Type::NonNullList(item) => {
                // Mostly one or two items; now and then dozens, which deepens the SQL.
                let count = if depth <= 4 && self.filter_budget > 64 && self.rng.chance(0.06) {
                    self.rng.range(8, 64)
                } else {
                    self.rng.range(1, 2)
                };
                Value::Array(
                    (0..count)
                        .map(|_| self.input_type(item, field, depth))
                        .collect(),
                )
            }
        }
    }

    pub(super) fn entity_id(&mut self, typename: &str) -> String {
        let pool: Vec<String> = self
            .pools
            .core
            .iter()
            .chain(&self.pools.channels)
            .chain(&self.pools.threads)
            .filter(|spec| spec.typename == typename)
            .map(|spec| spec.id.clone())
            .collect();
        if pool.is_empty() || self.rng.chance(0.1) {
            NIL.to_owned()
        } else {
            pick(&mut self.rng, &pool).clone()
        }
    }

    /// An address, or a piece of one, of someone in this cache.
    pub(super) fn email_part(&mut self, field: &str) -> String {
        let email = if self.pools.contacts.is_empty() || self.rng.chance(0.1) {
            "nobody@example.com".to_owned()
        } else {
            pick(&mut self.rng, &self.pools.contacts).email.clone()
        };
        match field {
            "domain" => email
                .split_once('@')
                .map_or(email.clone(), |(_, domain)| domain.to_owned()),
            "partial" => {
                let cut = 1 + self.rng.below(email.len() as u64) as usize;
                email[..cut.min(email.len())].to_owned()
            }
            _ => email,
        }
    }

    pub(super) fn scalar(&mut self, ty: &str, field: &str) -> Value {
        match ty {
            "Boolean" => Value::Bool(self.rng.chance(0.5)),
            "Int" => json!(self.rng.below(50)),
            "Float" => json!(self.rng.below(1000) as f64 / 10.0),
            "ID" => Value::String(match field {
                "id" | "projectIdSelf" | "projectId" => {
                    let typename = *pick(
                        &mut self.rng,
                        &[
                            "GraphqlSoupDocument",
                            "GraphqlSoupProject",
                            "GraphqlSoupChat",
                        ],
                    );
                    self.entity_id(typename)
                }
                "chatId" => self.entity_id("GraphqlSoupChat"),
                "channelId" => self.entity_id("GraphqlSoupChannel"),
                "threadId" => self.entity_id("GraphqlSoupEmailThread"),
                "owner" => self.links[0].clone(),
                _ => NIL.to_owned(),
            }),
            "DateTime" => {
                let time = self.time();
                Value::String(rfc3339(time))
            }
            _ => Value::String(match field {
                "owner" | "mention" => self.viewer.clone(),
                "sender" | "rootSender" | "participant" | "attendee" | "organizer" | "complete"
                | "partial" | "domain" | "recipient" => self.email_part(field),
                "fileType" => pick(&mut self.rng, &["md", "pdf", "docx", "canvas"]).to_string(),
                "gt" | "lt" | "gte" | "lte" | "start" | "end" | "startsBefore" | "endsAfter"
                | "before" | "after" => {
                    let time = self.time();
                    rfc3339(time)
                }
                _ => {
                    let text = self.query_text();
                    if text.trim().is_empty() {
                        words(&mut self.rng, 1)
                    } else {
                        text
                    }
                }
            }),
        }
    }
}
