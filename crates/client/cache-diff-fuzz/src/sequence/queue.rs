//! The optimistic mutation queue: enqueued writes and the server's answers to them.

use super::*;

impl Gen<'_> {
    pub(super) fn enqueue(&mut self) {
        let mut items: Vec<ItemSpec> = Vec::new();
        let count = self.rng.range(1, 6);
        for _ in 0..count {
            // A known email thread a third of the time: a copy at another revision
            // can move it in or out of the Inbox while it is pending.
            let known = if !self.pools.threads.is_empty() && self.rng.chance(0.3) {
                &self.pools.threads
            } else {
                &self.pools.core
            };
            if self.rng.chance(0.7) && !known.is_empty() {
                let mut spec = pick(&mut self.rng, known).clone();
                // An optimistic copy: what the client expects the server to say.
                spec.revision += 1000 + self.rng.below(3);
                if self.rng.chance(0.3) {
                    spec.time_ms = self.clock;
                }
                items.push(spec);
            } else {
                let typename = *pick(
                    &mut self.rng,
                    &[
                        "GraphqlSoupDocument",
                        "GraphqlSoupChat",
                        "GraphqlSoupProject",
                        "GraphqlSoupEmailThread",
                    ],
                );
                let mut spec = self.spec(typename);
                spec.time_ms = self.clock;
                spec.messages = 1;
                self.departed.push(format!("{}:{}", spec.typename, spec.id));
                items.push(spec);
            }
        }
        let data = self.response("Soup", &items, None);
        let uuid = if !self.uuids.is_empty() && self.rng.chance(0.3) {
            pick(&mut self.rng, &self.uuids).clone()
        } else {
            let uuid = self.rng.uuid();
            self.ids.insert(uuid.clone());
            self.uuids.push(uuid.clone());
            uuid
        };
        let created_at_ms = self.tick();
        let now_ms = self.tick();
        let owner = pick(&mut self.rng, &["runner-a", "runner-b"]).to_string();
        let lease_ms = *pick(&mut self.rng, &[1_000, 60_000, 600_000]);
        let tx = self.enqueued;
        self.enqueued += 1;
        let variables = json!({ "input": { "initial": {
            "limit": 50, "expand": true, "sortMethod": "VIEWED_UPDATED", "emailView": "ALL",
        } } });
        self.push(Op::Enqueue {
            tx,
            uuid,
            doc: "Soup".into(),
            variables: variables.as_object().cloned().unwrap_or_default(),
            data,
            created_at_ms,
            owner,
            now_ms,
            lease_ms,
        });
    }

    pub(super) fn commit(&mut self) {
        let Some(tx) = self.pick_tx() else {
            return;
        };
        // The server answers with the entities it really has.
        let mut items: Vec<ItemSpec> = Vec::new();
        let count = self.rng.range(0, 4);
        for _ in 0..count {
            if self.pools.core.is_empty() {
                break;
            }
            let index = self.rng.below(self.pools.core.len() as u64) as usize;
            if self.rng.chance(0.5) {
                self.pools.core[index].revision += 1;
            }
            items.push(self.pools.core[index].clone());
        }
        let data = self.response("Soup", &items, None);
        let variables = json!({ "input": { "initial": {
            "limit": 50, "expand": true, "sortMethod": "VIEWED_UPDATED", "emailView": "ALL",
        } } });
        self.push(Op::Commit {
            tx,
            doc: "Soup".into(),
            variables: variables.as_object().cloned().unwrap_or_default(),
            data,
        });
    }
}
