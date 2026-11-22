//! Synthesizes a GraphQL response for any of the app's documents from the
//! schema: every selected field gets a value of its declared type, abstract
//! types resolve to a concrete member, and field names steer sizes and shapes
//! (bodies, subjects, timestamps) towards what real Macro data looks like.

use crate::rng::{Rng, html, mix, prose, words};
use apollo_compiler::executable::{Field, Selection, SelectionSet};
use apollo_compiler::schema::{ExtendedType, Implementers, Type};
use apollo_compiler::validation::Valid;
use apollo_compiler::{ExecutableDocument, Name, Node, Schema};
use serde_json::{Map, Value, json};
use soup_filter_projection::{
    MailCacheProjectionFacts, SoupCacheProjectionSupplement, encode_cache_projection_supplement,
};

/// One explicit row of a list the dataset controls (Soup `items`, contact `nodes`).
#[derive(Clone, Debug)]
pub struct ItemSpec {
    pub typename: String,
    pub id: String,
    pub time_ms: i64,
    /// Email thread message count; ignored for other types.
    pub messages: usize,
    /// Bumped when the server's copy of the entity changes; 0 is the first copy.
    pub revision: u64,
}

/// Body sizes in bytes (medians); the generator spreads them log-normally.
#[derive(Clone, Copy, Debug)]
pub struct BodyProfile {
    pub html_median: f64,
    pub text_median: f64,
}

/// What the dataset controls in one response.
pub struct Plan<'a> {
    pub items: &'a [ItemSpec],
    /// The entity a single-entity query (a thread page) returns.
    pub focus: Option<&'a ItemSpec>,
    pub viewer_id: &'a str,
    pub link_ids: &'a [String],
    pub body: BodyProfile,
    /// 0 for the seed; a foreground variant rewrites the same entities, under
    /// the same ids, with other field values.
    pub revision: u64,
    /// Every timestamp of an entity equals its `time_ms`, so sort keys tie.
    pub tie: bool,
    /// The share of email threads given `WIDE_PROPERTIES` properties.
    pub wide_properties: f64,
}

#[derive(Clone, Copy)]
struct EntityCtx {
    seed: u64,
    time_ms: i64,
    messages: usize,
}

pub struct Faker {
    schema: Valid<Schema>,
    implementers: apollo_compiler::collections::HashMap<Name, Implementers>,
}

const CLIENT_DIRECTIVES: &str =
    "\ndirective @cacheOnly on FIELD | FRAGMENT_SPREAD | INLINE_FRAGMENT\n";

impl Faker {
    pub fn new(sdl: &str) -> Result<Self, rootcause::Report> {
        let schema =
            Schema::parse_and_validate(format!("{sdl}{CLIENT_DIRECTIVES}"), "schema.graphql")
                .map_err(|errors| rootcause::report!("schema: {}", errors.errors))?;
        let implementers = schema.implementers_map();
        Ok(Self {
            schema,
            implementers,
        })
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn parse(&self, source: &str) -> Result<ExecutableDocument, rootcause::Report> {
        ExecutableDocument::parse_and_validate(&self.schema, source, "document.graphql")
            .map(|valid| valid.into_inner())
            .map_err(|errors| rootcause::report!("document: {}", errors.errors))
    }

    /// `{"data": …}` for the document's single operation.
    pub fn response(&self, document: &ExecutableDocument, plan: &Plan<'_>, seed: u64) -> Value {
        let operation = document
            .operations
            .iter()
            .next()
            .expect("document has an operation");
        let ty = operation.selection_set.ty.clone();
        let ctx = EntityCtx {
            seed,
            time_ms: plan.items.first().map_or(NOW_MS, |item| item.time_ms),
            messages: 0,
        };
        let data = self.object(document, &ty, &[&operation.selection_set], ctx, None, plan);
        json!({ "data": data })
    }

    fn collect<'d>(
        &self,
        document: &'d ExecutableDocument,
        concrete: &str,
        set: &'d SelectionSet,
        out: &mut Vec<(Name, Vec<&'d Node<Field>>)>,
    ) {
        for selection in &set.selections {
            match selection {
                Selection::Field(field) => {
                    let key = field.response_key().clone();
                    match out.iter_mut().find(|(existing, _)| *existing == key) {
                        Some((_, fields)) => fields.push(field),
                        None => out.push((key, vec![field])),
                    }
                }
                Selection::FragmentSpread(spread) => {
                    if let Some(fragment) = document.fragments.get(&spread.fragment_name)
                        && self.applies(fragment.type_condition(), concrete)
                    {
                        self.collect(document, concrete, &fragment.selection_set, out);
                    }
                }
                Selection::InlineFragment(inline) => {
                    let applies = inline
                        .type_condition
                        .as_ref()
                        .is_none_or(|condition| self.applies(condition, concrete));
                    if applies {
                        self.collect(document, concrete, &inline.selection_set, out);
                    }
                }
            }
        }
    }

    fn applies(&self, condition: &str, concrete: &str) -> bool {
        condition == concrete || self.schema.is_subtype(condition, concrete)
    }

    fn concrete_types(&self, ty: &Name) -> Vec<Name> {
        match self.schema.types.get(ty) {
            Some(ExtendedType::Interface(_)) => self
                .implementers
                .get(ty)
                .map(|implementers| implementers.objects.iter().cloned().collect())
                .unwrap_or_default(),
            Some(ExtendedType::Union(union)) => union
                .members
                .iter()
                .map(|member| member.name.clone())
                .collect(),
            _ => vec![ty.clone()],
        }
    }

    fn object(
        &self,
        document: &ExecutableDocument,
        concrete: &Name,
        sets: &[&SelectionSet],
        ctx: EntityCtx,
        explicit_id: Option<&str>,
        plan: &Plan<'_>,
    ) -> Value {
        let mut fields = Vec::new();
        for set in sets {
            self.collect(document, concrete, set, &mut fields);
        }
        let mut ctx = ctx;
        let focused = plan
            .focus
            .filter(|spec| explicit_id.is_none() && spec.typename == concrete.as_str());
        if let Some(spec) = focused {
            ctx = EntityCtx {
                seed: spec_seed(spec),
                time_ms: spec.time_ms,
                messages: spec.messages,
            };
        }
        let explicit_id = explicit_id.or(focused.map(|spec| spec.id.as_str()));
        let id = if fields.iter().any(|(_, fs)| fs[0].name == "id") {
            Some(match (explicit_id, concrete.as_str()) {
                (Some(id), _) => id.to_owned(),
                (None, "GraphqlUser") => plan.viewer_id.to_owned(),
                (None, "GraphqlEmailLink") => {
                    let index = Rng::new(ctx.seed).below(plan.link_ids.len() as u64) as usize;
                    plan.link_ids[index].clone()
                }
                (None, _) => Rng::new(mix(ctx.seed, "id")).uuid(),
            })
        } else {
            None
        };
        if let (Some(id), "GraphqlUser" | "GraphqlEmailLink") = (&id, concrete.as_str()) {
            // Shared entities read the same however often they appear.
            ctx.seed = mix(0, &format!("{concrete}:{id}"));
        }
        let mut map = Map::new();
        for (key, group) in &fields {
            let field = group[0];
            let field_seed = mix(ctx.seed, key);
            let mut rng = Rng::new(match plan.revision {
                0 => field_seed,
                revision => mix(field_seed, &format!("revision{revision}")),
            });
            let value = match field.name.as_str() {
                "__typename" => Value::String(concrete.to_string()),
                "id" => Value::String(id.clone().unwrap_or_default()),
                "cacheProjection" => cache_projection(concrete, id.as_deref(), ctx, &mut rng),
                _ => {
                    let sub_sets: Vec<&SelectionSet> =
                        group.iter().map(|field| &field.selection_set).collect();
                    self.value(
                        document,
                        concrete,
                        &field.definition.ty,
                        field.name.as_str(),
                        &sub_sets,
                        ctx,
                        &mut rng,
                        plan,
                        false,
                    )
                }
            };
            map.insert(key.to_string(), value);
        }
        if concrete == "GraphqlProperty"
            && let Some(kind) = map
                .get("value")
                .and_then(|value| value.get("__typename"))
                .and_then(Value::as_str)
                .and_then(property_data_type)
            && map.contains_key("dataType")
        {
            map.insert("dataType".to_owned(), Value::String(kind.to_owned()));
        }
        Value::Object(map)
    }

    #[expect(clippy::too_many_arguments, reason = "recursive generator state")]
    fn value(
        &self,
        document: &ExecutableDocument,
        parent: &Name,
        ty: &Type,
        name: &str,
        sets: &[&SelectionSet],
        ctx: EntityCtx,
        rng: &mut Rng,
        plan: &Plan<'_>,
        in_list: bool,
    ) -> Value {
        match ty {
            Type::Named(inner) => {
                if !in_list && self.null_chance(inner, name, rng) {
                    return Value::Null;
                }
                self.named(document, parent, inner, name, sets, ctx, rng, plan)
            }
            Type::NonNullNamed(inner) => {
                self.named(document, parent, inner, name, sets, ctx, rng, plan)
            }
            Type::List(item) | Type::NonNullList(item) => {
                if matches!(ty, Type::List(_)) && rng.chance(0.05) && !is_explicit_list(name) {
                    return Value::Null;
                }
                self.list(document, parent, item, name, sets, ctx, rng, plan)
            }
        }
    }

    #[expect(clippy::too_many_arguments, reason = "recursive generator state")]
    fn list(
        &self,
        document: &ExecutableDocument,
        parent: &Name,
        item: &Type,
        name: &str,
        sets: &[&SelectionSet],
        ctx: EntityCtx,
        rng: &mut Rng,
        plan: &Plan<'_>,
    ) -> Value {
        if is_explicit_list(name) {
            return Value::Array(
                plan.items
                    .iter()
                    .map(|spec| {
                        let concrete = Name::new(&spec.typename).expect("valid type name");
                        let seed = spec_seed(spec);
                        self.object(
                            document,
                            &concrete,
                            sets,
                            EntityCtx {
                                seed,
                                time_ms: spec.time_ms,
                                messages: spec.messages,
                            },
                            Some(&spec.id),
                            plan,
                        )
                    })
                    .collect(),
            );
        }
        if name == "messages" && parent == "GraphqlSoupEmailThread" {
            return Value::Array(
                (0..ctx.messages)
                    .map(|index| {
                        let seed = mix(ctx.seed, &format!("message{index}"));
                        let id = Rng::new(seed).uuid();
                        let concrete = Name::new("GraphqlSoupEmailMessage").expect("name");
                        self.object(
                            document,
                            &concrete,
                            sets,
                            EntityCtx {
                                seed,
                                time_ms: ctx.time_ms - (index as i64) * 3_600_000,
                                messages: 0,
                            },
                            Some(&id),
                            plan,
                        )
                    })
                    .collect(),
            );
        }
        let len = list_len(name, parent, rng, plan);
        Value::Array(
            (0..len)
                .map(|index| {
                    let child = EntityCtx {
                        seed: mix(ctx.seed, &format!("{name}[{index}]")),
                        ..ctx
                    };
                    let mut item_rng = Rng::new(child.seed);
                    self.value(
                        document,
                        parent,
                        item,
                        name,
                        sets,
                        child,
                        &mut item_rng,
                        plan,
                        true,
                    )
                })
                .collect(),
        )
    }

    fn null_chance(&self, ty: &Name, name: &str, rng: &mut Rng) -> bool {
        let object = matches!(
            self.schema.types.get(ty),
            Some(ExtendedType::Object(_) | ExtendedType::Interface(_) | ExtendedType::Union(_))
        );
        let p = match name {
            "bodyMacro"
            | "calendarInvitations"
            | "scheduledSendTime"
            | "scheduledSendStatus"
            | "replyingToId"
            | "deletedAt"
            | "archivedAt"
            | "archivedBy" => 0.9,
            // Property completeness needs the favorite flag on every entity.
            "isFavorited" => 0.0,
            "bodyHtmlSanitized" | "bodyText" | "subject" | "name" | "displayName" => 0.02,
            _ if object => 0.2,
            _ => 0.1,
        };
        rng.chance(p)
    }

    #[expect(clippy::too_many_arguments, reason = "recursive generator state")]
    fn named(
        &self,
        document: &ExecutableDocument,
        parent: &Name,
        ty: &Name,
        name: &str,
        sets: &[&SelectionSet],
        ctx: EntityCtx,
        rng: &mut Rng,
        plan: &Plan<'_>,
    ) -> Value {
        match self.schema.types.get(ty) {
            Some(ExtendedType::Enum(def)) => {
                if name == "entityType"
                    && let Some(kind) = soup_entity_type(parent.as_str())
                    && def.values.contains_key(kind)
                {
                    return Value::String(kind.to_owned());
                }
                let values: Vec<_> = def
                    .values
                    .iter()
                    .filter(|(_, value)| !value.directives.has("deprecated"))
                    .map(|(key, _)| key)
                    .collect();
                Value::String(values[rng.below(values.len() as u64) as usize].to_string())
            }
            Some(ExtendedType::Scalar(_)) | None => leaf(ty.as_str(), name, parent, ctx, rng, plan),
            Some(ExtendedType::Object(_)) => {
                let child = EntityCtx {
                    seed: rng.next_u64(),
                    time_ms: jitter(ctx.time_ms, 86_400_000, rng, plan),
                    messages: ctx.messages,
                };
                self.object(document, ty, sets, child, None, plan)
            }
            Some(ExtendedType::Interface(_) | ExtendedType::Union(_)) => {
                // Prefer a member the document actually selects fields for.
                let candidates = self.concrete_types(ty);
                let selected: Vec<&Name> = candidates
                    .iter()
                    .filter(|candidate| mentions(document, sets, candidate))
                    .collect();
                let mut pool: Vec<&Name> = if selected.is_empty() {
                    candidates.iter().collect()
                } else {
                    selected
                };
                if parent == "GraphqlProperty" && name == "value" {
                    // Date ranges never project in the cache; the bench models
                    // the values the cache can index.
                    pool.retain(|candidate| property_data_type(candidate).is_some());
                }
                let concrete = pool[rng.below(pool.len() as u64) as usize].clone();
                let child = EntityCtx {
                    seed: rng.next_u64(),
                    ..ctx
                };
                self.object(document, &concrete, sets, child, None, plan)
            }
            Some(ExtendedType::InputObject(_)) => Value::Null,
        }
    }
}

const NOW_MS: i64 = 1_795_000_000_000;

/// The data type a property value's GraphQL type stands for, for the value
/// types the cache projects.
fn property_data_type(typename: &str) -> Option<&'static str> {
    Some(match typename {
        "GraphqlBooleanPropertyValue" => "BOOLEAN",
        "GraphqlNumberPropertyValue" => "NUMBER",
        "GraphqlStringPropertyValue" => "STRING",
        "GraphqlDatePropertyValue" => "DATE",
        "GraphqlSelectOptionPropertyValue" => "SELECT_STRING",
        "GraphqlEntityReferencePropertyValue" => "ENTITY",
        "GraphqlLinkPropertyValue" => "LINK",
        _ => return None,
    })
}

fn is_explicit_list(name: &str) -> bool {
    matches!(name, "items" | "nodes")
}

fn mentions(document: &ExecutableDocument, sets: &[&SelectionSet], ty: &str) -> bool {
    fn walk(document: &ExecutableDocument, set: &SelectionSet, ty: &str, depth: u8) -> bool {
        if depth > 4 {
            return false;
        }
        set.selections.iter().any(|selection| match selection {
            Selection::InlineFragment(inline) => {
                inline.type_condition.as_ref().is_some_and(|c| c == ty)
                    || walk(document, &inline.selection_set, ty, depth + 1)
            }
            Selection::FragmentSpread(spread) => document
                .fragments
                .get(&spread.fragment_name)
                .is_some_and(|fragment| {
                    fragment.type_condition() == ty
                        || walk(document, &fragment.selection_set, ty, depth + 1)
                }),
            Selection::Field(_) => false,
        })
    }
    sets.iter().any(|set| walk(document, set, ty, 0))
}

/// How many properties a wide email thread has. Each has its own definition and
/// so its own row attribute, and a select or entity value with an option or
/// reference one more (about 1.15 attributes a property). With a thread's 13 to
/// 16 other attributes that comes to about 240 to 275, around the predicate
/// index's limit of 256 distinct attributes per document.
const WIDE_PROPERTIES: (u64, u64) = (196, 222);

fn list_len(name: &str, parent: &Name, rng: &mut Rng, plan: &Plan<'_>) -> usize {
    match name {
        // No draw unless asked for, so cases without wide threads stay as they were.
        "properties"
            if parent == "GraphqlSoupEmailThread"
                && plan.wide_properties > 0.0
                && rng.chance(plan.wide_properties) =>
        {
            rng.range(WIDE_PROPERTIES.0, WIDE_PROPERTIES.1) as usize
        }
        "to" => rng.range(1, 3) as usize,
        "cc" => rng.range(0, 2) as usize,
        "bcc" | "attachmentsDraft" | "attachmentsForwarded" | "drafts" => 0,
        "labels" => rng.range(1, 3) as usize,
        "attachments" => usize::from(rng.chance(0.2)),
        "properties" => rng.range(0, 4) as usize,
        "emailLinks" => 2,
        _ => rng.range(0, 2) as usize,
    }
}

fn leaf(
    scalar: &str,
    name: &str,
    parent: &Name,
    ctx: EntityCtx,
    rng: &mut Rng,
    plan: &Plan<'_>,
) -> Value {
    let lower = name.to_ascii_lowercase();
    match scalar {
        "Boolean" => Value::Bool(match name {
            "isRead" => rng.chance(0.75),
            "isDraft" => rng.chance(0.03),
            "isSent" => rng.chance(0.3),
            "inboxVisible" => rng.chance(0.4),
            "isSignal" => rng.chance(0.4),
            "hasAttachments" => rng.chance(0.2),
            _ => rng.chance(0.3),
        }),
        "Int" | "Float" => {
            if lower.ends_with("ts") || lower.ends_with("at") || lower.ends_with("time") {
                json!(jitter(ctx.time_ms, 600_000, rng, plan))
            } else if lower.contains("size") {
                json!(rng.range(1_000, 5_000_000))
            } else if scalar == "Float" {
                json!((rng.unit() * 100.0 * 1000.0).round() / 1000.0)
            } else {
                json!(rng.range(0, 50))
            }
        }
        "ID" => Value::String(match name {
            "ownerId" | "userId" | "senderId" => plan.viewer_id.to_owned(),
            "linkId" => plan.link_ids[rng.below(plan.link_ids.len() as u64) as usize].clone(),
            // Organizations have integer ids.
            "organizationId" => rng.range(1, 5_000).to_string(),
            _ => rng.uuid(),
        }),
        "DateTime" => Value::String(rfc3339(jitter(ctx.time_ms, 600_000, rng, plan))),
        "JSON" | "SoupCacheProjection" => Value::Null,
        _ => Value::String(string_value(name, &lower, parent, ctx, rng, plan)),
    }
}

fn string_value(
    name: &str,
    lower: &str,
    parent: &Name,
    ctx: EntityCtx,
    rng: &mut Rng,
    plan: &Plan<'_>,
) -> String {
    match name {
        "bodyHtmlSanitized" | "bodyHtml" => {
            let size = rng.size_around(plan.body.html_median, 0.9, 400, 400_000);
            html(rng, size)
        }
        "bodyText" => {
            let size = rng.size_around(plan.body.text_median, 0.8, 80, 60_000);
            prose(rng, size)
        }
        "bodyReplyless" => {
            let size = rng.size_around(plan.body.text_median / 2.0, 0.8, 40, 30_000);
            prose(rng, size)
        }
        "snippet" => prose(rng, 160),
        "content" => {
            let size = rng.range(20, 400) as usize;
            prose(rng, size)
        }
        "ownerId" | "userId" | "senderId" => plan.viewer_id.to_owned(),
        "linkId" => plan.link_ids[rng.below(plan.link_ids.len() as u64) as usize].clone(),
        // The cache projects only the channel kinds the server sends.
        "channelType" => {
            const KINDS: [&str; 4] = ["public", "private", "team", "direct_message"];
            KINDS[rng.below(KINDS.len() as u64) as usize].to_owned()
        }
        _ if lower.ends_with("id") => rng.uuid(),
        _ if lower.ends_with("ids") => rng.uuid(),
        _ if lower.contains("email") => {
            format!(
                "{}.{}@{}.com",
                words(rng, 1),
                rng.below(5000),
                words(rng, 1)
            )
        }
        _ if lower.ends_with("url") || lower == "urls" => {
            format!("https://cdn.example.com/{}/{}", parent, rng.uuid())
        }
        _ if lower.ends_with("at") || lower.ends_with("time") => {
            rfc3339(jitter(ctx.time_ms, 600_000, rng, plan))
        }
        // The server sends message timestamps (`latestInboundMessageTs`, …) as RFC 3339.
        _ if lower.ends_with("ts") => rfc3339(jitter(ctx.time_ms, 600_000, rng, plan)),
        _ if lower.contains("name") || lower == "subject" || lower == "title" => {
            let count = rng.range(2, 7) as usize;
            words(rng, count)
        }
        _ => format!("{}-{}", words(rng, 1), rng.below(100_000)),
    }
}

fn cache_projection(concrete: &Name, id: Option<&str>, ctx: EntityCtx, rng: &mut Rng) -> Value {
    let Some(id) = id else {
        return Value::Null;
    };
    let Ok(key) = predicate_index::RecordKey::new(format!("{concrete}:{id}")) else {
        return Value::Null;
    };
    let supplement = match concrete.as_str() {
        "GraphqlSoupDocument" => SoupCacheProjectionSupplement::document(
            key,
            rng.chance(0.05),
            rng.chance(0.1),
            Vec::new(),
        ),
        "GraphqlSoupEmailThread" => {
            let latest = ctx.time_ms * 1000;
            let outbound = rng.chance(0.3).then_some(latest - 3_600_000_000);
            SoupCacheProjectionSupplement::mail(
                key,
                MailCacheProjectionFacts::new(Some(latest), outbound, rng.chance(0.03), false),
            )
        }
        _ => return Value::Null,
    };
    encode_cache_projection_supplement(&supplement).map_or(Value::Null, Value::String)
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ` for Unix milliseconds.
pub fn rfc3339(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// The `entityType` a Soup item reports for its own typename.
fn soup_entity_type(typename: &str) -> Option<&'static str> {
    Some(match typename.strip_prefix("GraphqlSoup")? {
        "Document" => "DOCUMENT",
        "Chat" => "CHAT",
        "Project" => "PROJECT",
        "EmailThread" => "EMAIL_THREAD",
        "Channel" => "CHANNEL",
        "Initiative" => "INITIATIVE",
        "Call" => "CALL",
        "CalendarEvent" => "CALENDAR_EVENT",
        _ => return None,
    })
}

/// An entity's seed: its identity and the server revision of its copy.
fn spec_seed(spec: &ItemSpec) -> u64 {
    mix(spec.revision, &format!("{}:{}", spec.typename, spec.id))
}

/// A timestamp up to `spread` ms before `time_ms`, or exactly `time_ms` when
/// the plan ties every timestamp.
fn jitter(time_ms: i64, spread: u64, rng: &mut Rng, plan: &Plan<'_>) -> i64 {
    let offset = rng.below(spread) as i64;
    if plan.tie { time_ms } else { time_ms - offset }
}
