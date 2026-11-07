//! Bounded evidence for resolving inferred labels across the cached directory.

use super::{
    CONTEXT_FIELD, MAX_PEOPLE_BATCH, MAX_REFERENCE_WITNESSES, PEOPLE_POLICY_VERSION, PeopleError,
    StoredFacts,
};
use crate::{
    engine::HydrationScope,
    value::{CacheValue, EntityKey, Record},
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use subsequence_match::normalize_text;
use uuid::Uuid;

/// How a caller's inferred names resolve; these are not suggestion rankings.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub enum ReferenceMatchMode {
    /// Match an entire name, address or identity only.
    Exact,
    /// Prefer whole names/addresses/identities, otherwise require a unique first name.
    PreferFullName,
    /// Treat whole and first names equally, as inferred user property values do.
    AnyName,
}

/// Resolve a bounded set of labels without materializing a personal directory.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub struct PeopleReferenceRequest {
    /// Account/storage admission fence.
    pub scope: HydrationScope,
    /// Raw input count is capped before deduplication; each label is at most 512 UTF-8 bytes.
    #[cfg_attr(any(test, feature = "schema"), schemars(length(max = MAX_PEOPLE_BATCH)))]
    pub labels: Vec<String>,
    /// Name matching owned by the requesting surface.
    pub matching: ReferenceMatchMode,
    /// Recipient/planner pools can omit connected secondary inboxes, using ready local context.
    pub exclude_secondary_inboxes: bool,
}

/// One authorized cached contact used as matching evidence, not a suggestion catalog.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub struct PersonReference {
    /// Canonical target identity, never the viewer-scoped record id.
    #[cfg_attr(any(test, feature = "schema"), schemars(with = "String"))]
    pub user_id: MacroUserIdStr<'static>,
    /// The contact's address.
    pub email: String,
    /// The stored private name; absence must not invent a first-name match from an email local part.
    pub name: Option<String>,
}

/// Evidence for one input label, in the same order as the request.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub struct PeopleReferenceMatch {
    /// At most two distinct witnesses. Two means ambiguous, not a complete candidate list.
    #[cfg_attr(any(test, feature = "schema"), schemars(length(max = MAX_REFERENCE_WITNESSES)))]
    pub people: Vec<PersonReference>,
    /// Malformed matching records cannot establish uniqueness. The caller must also
    /// check directory hydration completeness before relying on a single witness.
    pub complete: bool,
}

/// Read-only reference resolution never publishes context or changes membership.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub enum PeopleReferenceResult {
    /// Required secondary-inbox exclusions are not ready.
    ContextPending,
    /// A bounded result for every requested label.
    Resolved {
        /// Matching contract version, shared with person policy capability admission.
        #[serde(rename = "policyVersion")]
        policy_version: u32,
        /// Same length/order as the raw input labels, including duplicates.
        #[cfg_attr(any(test, feature = "schema"), schemars(length(max = MAX_PEOPLE_BATCH)))]
        matches: Vec<PeopleReferenceMatch>,
    },
}

struct Evidence {
    priority: u8,
    matched: PeopleReferenceMatch,
}

pub(crate) struct ReferenceCollector<'a> {
    request: &'a PeopleReferenceRequest,
    epoch: Option<Uuid>,
    namespace: Uuid,
    by_label: HashMap<String, usize>,
    order: Vec<usize>,
    evidence: Vec<Evidence>,
}

impl<'a> ReferenceCollector<'a> {
    pub(crate) fn new(
        request: &'a PeopleReferenceRequest,
        epoch: Option<Uuid>,
    ) -> Result<Self, PeopleError> {
        if request.labels.len() > MAX_PEOPLE_BATCH
            || request.labels.iter().any(|label| {
                label.len() > subsequence_match::MAX_QUERY_BYTES || label.trim().is_empty()
            })
        {
            return Err(PeopleError::InvalidInput);
        }
        let mut by_label = HashMap::new();
        let mut order = Vec::with_capacity(request.labels.len());
        let mut evidence = Vec::new();
        for label in &request.labels {
            let label = normalize_text(label);
            let index = *by_label.entry(label).or_insert_with(|| {
                let index = evidence.len();
                evidence.push(Evidence {
                    priority: 0,
                    matched: PeopleReferenceMatch {
                        people: Vec::new(),
                        complete: true,
                    },
                });
                index
            });
            order.push(index);
        }
        Ok(Self {
            request,
            epoch,
            namespace: Uuid::new_v5(&Uuid::NAMESPACE_OID, request.scope.identity.as_bytes()),
            by_label,
            order,
            evidence,
        })
    }

    pub(crate) fn set_epoch(&mut self, epoch: Uuid) {
        self.epoch = Some(epoch);
    }

    pub(crate) fn push(&mut self, key: &EntityKey<'_>, record: &Record) {
        let Some(CacheValue::String(raw_user)) = record.fields.get("userId") else {
            return;
        };
        let Ok(user) = MacroUserIdStr::parse_from_str(raw_user) else {
            return;
        };
        let Some(CacheValue::String(email)) = record.fields.get("email") else {
            return;
        };
        if raw_user.len() > 1024 || !email.eq_ignore_ascii_case(user.email_str()) {
            return;
        }
        // Foreign-viewer rows must not affect even the ambiguity/completeness
        // flags. Check ownership before inspecting their private names.
        let expected = Uuid::new_v5(&self.namespace, user.as_ref().as_bytes());
        let mut buffer = Uuid::encode_buffer();
        let expected: &str = expected.hyphenated().encode_lower(&mut buffer);
        if key.typename() != Some("GraphqlContact") || key.id() != Some(expected) {
            return;
        }
        let name = match record.fields.get("name") {
            Some(CacheValue::String(name)) => Some(name.as_str()),
            Some(CacheValue::Null) => None,
            _ => {
                // An unreadable owned name could match any requested label;
                // retaining one readable witness cannot prove uniqueness.
                for evidence in &mut self.evidence {
                    evidence.matched.complete = false;
                }
                return;
            }
        };
        let label = normalize_text(name.unwrap_or(email));
        let first = label.split_whitespace().next().unwrap_or("");
        let whole_priority = if self.request.matching == ReferenceMatchMode::AnyName {
            1
        } else {
            2
        };
        // A row can match several requested labels; observe at most four labels
        // and clone only the first two distinct witnesses of the strongest tier.
        let matches = [
            (self.by_label.get(user.as_ref()).copied(), whole_priority),
            (self.by_label.get(user.email_str()).copied(), whole_priority),
            (self.by_label.get(&label).copied(), whole_priority),
            (
                if self.request.matching == ReferenceMatchMode::Exact {
                    None
                } else {
                    self.by_label.get(first).copied()
                },
                1,
            ),
        ];
        if matches.iter().all(|(index, _)| index.is_none()) {
            return;
        }
        let mut complete = true;
        if self.request.exclude_secondary_inboxes {
            match record.fields.get(CONTEXT_FIELD) {
                None => {}
                Some(CacheValue::Opaque(value)) => match serde_json::from_str::<StoredFacts>(value)
                {
                    Ok(stored)
                        if Some(stored.epoch) == self.epoch && stored.facts.secondary_inbox =>
                    {
                        return;
                    }
                    Ok(_) => {}
                    Err(_) => complete = false,
                },
                Some(_) => complete = false,
            }
        }
        for (index, priority) in matches {
            let Some(evidence) = index.and_then(|index| self.evidence.get_mut(index)) else {
                continue;
            };
            if !complete {
                evidence.matched.complete = false;
                continue;
            }
            if priority < evidence.priority {
                continue;
            }
            if priority > evidence.priority {
                evidence.priority = priority;
                evidence.matched.people.clear();
            }
            if evidence.matched.people.len() < MAX_REFERENCE_WITNESSES
                && !evidence
                    .matched
                    .people
                    .iter()
                    .any(|person| person.user_id == user)
            {
                evidence.matched.people.push(PersonReference {
                    user_id: user.clone().into_owned(),
                    email: email.clone(),
                    name: name.map(str::to_owned),
                });
            }
        }
    }

    pub(crate) fn finish(self) -> Result<PeopleReferenceResult, PeopleError> {
        let matches = self
            .order
            .into_iter()
            .map(|index| {
                self.evidence
                    .get(index)
                    .map(|entry| entry.matched.clone())
                    .ok_or(PeopleError::InvalidInput)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(PeopleReferenceResult::Resolved {
            policy_version: PEOPLE_POLICY_VERSION,
            matches,
        })
    }
}

#[cfg(test)]
mod test;
