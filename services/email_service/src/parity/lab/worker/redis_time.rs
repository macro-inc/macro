//! Worker-only Redis rules for wall-clock-dependent request gate state.

use serde_json::{Value, json};
use std::collections::BTreeMap;

mod test;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum RedisRule {
    /// Pin admitted units, without pinning their split across wall-clock seconds.
    GmailGateWindowTotalUnits,
}

pub(super) fn changes(
    mut before: BTreeMap<String, Value>,
    mut after: BTreeMap<String, Value>,
    rules: &[RedisRule],
) -> Value {
    if rules.contains(&RedisRule::GmailGateWindowTotalUnits) {
        gmail_gate_window_total_units(&mut before);
        gmail_gate_window_total_units(&mut after);
    }
    let mut changes = crate::parity::redis::changes(before, after);
    for (key, change) in changes.as_object_mut().expect("Redis changes object") {
        if !key.starts_with("gmail:{") {
            continue;
        }
        if key.ends_with(":limit") {
            for side in ["before", "after"] {
                if let Some(limit) = change[side].as_object_mut()
                    && limit.contains_key("at")
                {
                    limit.insert("at".into(), json!("<timestamp>"));
                }
            }
        } else if key.ends_with(":inflight") || key.ends_with(":waiting") {
            for side in ["before", "after"] {
                if let Some(entries) = change[side].as_array_mut() {
                    for entry in entries {
                        if let Some(pair) = entry.as_array_mut()
                            && pair.len() == 2
                        {
                            pair[1] = json!("<timestamp>");
                        }
                    }
                }
            }
        }
    }
    changes
}

fn gmail_gate_window_total_units(snapshot: &mut BTreeMap<String, Value>) {
    for (key, value) in snapshot {
        let Some(link) = key
            .strip_prefix("gmail:{")
            .and_then(|rest| rest.strip_suffix("}:window"))
        else {
            continue;
        };
        // Match only the canonical UUID key emitted by the production gate.
        if !uuid::Uuid::parse_str(link).is_ok_and(|id| id.to_string() == link) {
            continue;
        }
        let Some(fields) = value.as_object_mut() else {
            continue;
        };
        let mut total = None::<u64>;
        fields.retain(|second, units| {
            if second.parse::<u64>().is_ok()
                && let Some(units) = units.as_str().and_then(|units| units.parse::<u64>().ok())
            {
                total = Some(total.unwrap_or(0).checked_add(units).expect("quota units"));
                false
            } else {
                true
            }
        });
        if let Some(total) = total {
            fields.insert("<total_units>".into(), json!(total.to_string()));
        }
    }
}
