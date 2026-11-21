//! Contacts and people: contact pages, people context, search and people search.

use super::*;

impl Gen<'_> {
    /// The id the server gives a contact: the engine's viewer-scoped contact key.
    pub(super) fn contact_id(&mut self, contact: &Contact) -> String {
        let id = match &contact.foreign {
            Some(id) => id.clone(),
            None => {
                let namespace =
                    uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, self.viewer.as_bytes());
                uuid::Uuid::new_v5(&namespace, contact.user.as_bytes()).to_string()
            }
        };
        self.ids.insert(id.clone());
        id
    }

    pub(super) fn contacts_page(&mut self, page: usize) {
        const LIMIT: usize = 200;
        let start = (page * LIMIT).min(self.pools.contacts.len());
        let end = (start + LIMIT).min(self.pools.contacts.len());
        let contacts = self.pools.contacts[start..end].to_vec();
        let nodes: Vec<Value> = contacts
            .iter()
            .map(|contact| {
                json!({
                    "__typename": "GraphqlContact",
                    "id": self.contact_id(contact),
                    "userId": contact.user,
                    "email": contact.email,
                    "name": contact.name,
                })
            })
            .collect();
        let next = (end < self.pools.contacts.len()).then(|| format!("contacts:{}", page + 1));
        let after = (page > 0).then(|| format!("contacts:{page}"));
        let data = json!({ "user": { "id": self.viewer, "contacts": { "nodes": nodes, "nextCursor": next } } });
        let variables = json!({ "limit": LIMIT, "after": after });
        self.push(Op::Hydrate {
            lane: "contacts".into(),
            doc: "ContactDirectoryBackfill".into(),
            variables: variables.as_object().cloned().unwrap_or_default(),
            data,
            identity: self.viewer.clone(),
            contacts: true,
        });
        if self.rng.chance(0.3) && !self.pools.contacts.is_empty() {
            // Contacts change on the server: renamed, removed, added.
            let index = self.rng.below(self.pools.contacts.len() as u64) as usize;
            if self.rng.chance(0.5) {
                let count = self.rng.range(1, 3) as usize;
                self.pools.contacts[index].name = Some(words(&mut self.rng, count));
            } else {
                self.pools.contacts.remove(index);
            }
            if self.rng.chance(0.5) {
                let contact = self.contact();
                self.pools.contacts.push(contact);
            }
        }
    }

    /// Every contact page and a people context, as the app loads them after sign-in.
    pub(super) fn people_backfill(&mut self) {
        for page in 0..self.pools.contacts.len().div_ceil(200) {
            self.contacts_page(page);
        }
        self.people_context();
    }

    pub(super) fn people_context(&mut self) {
        let epoch = self.rng.uuid();
        self.ids.insert(epoch.clone());
        self.push(Op::PeopleContext {
            identity: self.viewer.clone(),
            epoch,
        });
    }

    pub(super) fn query_text(&mut self) -> String {
        let tokens = *pick(&mut self.rng, &[0usize, 1, 1, 1, 2, 2, 3]);
        let mut out = String::new();
        for index in 0..tokens {
            if index > 0 {
                let gap = *pick(&mut self.rng, &[" ", " ", ",", "  ", "\t", ", "]);
                out.push_str(gap);
            }
            let word = words(&mut self.rng, 1);
            let chars: Vec<char> = word.chars().collect();
            let piece: String = match self.rng.below(5) {
                0 | 1 => word.clone(),
                2 => chars[..(1 + self.rng.below(chars.len() as u64) as usize).min(chars.len())]
                    .iter()
                    .collect(),
                3 => {
                    let start = self.rng.below(chars.len() as u64) as usize;
                    chars[start..].iter().collect()
                }
                _ => {
                    // A subsequence: every other character.
                    chars.iter().step_by(2).collect()
                }
            };
            let piece = match self.rng.below(4) {
                0 => piece.to_uppercase(),
                1 => piece.to_lowercase(),
                _ => piece,
            };
            out.push_str(&piece);
        }
        if self.rng.chance(0.03) {
            out.push('\u{0}');
        }
        out
    }

    pub(super) fn search(&mut self) -> Value {
        let query = self.query_text();
        let buckets: Vec<&str> = [
            "channel", "dm", "person", "document", "chat", "project", "email",
        ]
        .into_iter()
        .filter(|_| self.rng.chance(0.25))
        .collect();
        let limit = *pick(&mut self.rng, &[1u16, 5, 20, 20, 100, 500]);
        let mut request = json!({
            "profile": "quick-access-v1",
            "query": query,
            "limit": limit,
            "nowMs": self.clock,
        });
        if !buckets.is_empty() && self.rng.chance(0.5) {
            request["buckets"] = json!(buckets);
        }
        request
    }

    pub(super) fn people_search(&mut self) {
        let mode = pick(
            &mut self.rng,
            &["command", "recipient", "mention", "property"],
        )
        .to_string();
        let query = if self.rng.chance(0.2) && !self.pools.contacts.is_empty() {
            let contact = pick(&mut self.rng, &self.pools.contacts).clone();
            // A prefix of the email or of the name, cut on a character boundary.
            let text = match &contact.name {
                Some(name) if self.rng.chance(0.5) => name.clone(),
                _ => contact.email.clone(),
            };
            let chars = text.chars().count().max(1);
            let cut = 1 + self.rng.below(chars as u64) as usize;
            text.chars().take(cut).collect()
        } else {
            self.query_text()
        };
        let limit = *pick(&mut self.rng, &[1usize, 5, 20, 50]);
        let request = json!({
            "mode": mode,
            "query": query,
            "excluded": [],
            "senderDomain": null,
            "limit": limit,
            "nowMs": self.clock,
            "cursor": null,
        });
        let pages = *pick(&mut self.rng, &[1u8, 2, 3]);
        self.push(Op::PeopleSearch {
            identity: self.viewer.clone(),
            request,
            pages,
        });
    }
}
