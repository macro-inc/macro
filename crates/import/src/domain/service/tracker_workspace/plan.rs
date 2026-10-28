//! Stage the entire tracker snapshot, then apply group verdicts to its issues.

use super::*;
use crate::domain::models::NotionAlreadyImported;
use import_tracker::domain::model::{GroupKind, ObjectId};
use std::collections::{HashMap, HashSet};

pub(in crate::domain::service) fn group_key(id: &ObjectId) -> String {
    format!("group:{}", id.as_str())
}

pub(in crate::domain::service) fn rows(
    source: ImportSource,
    inventory: &Inventory,
    sharing: NotionSharing,
    team: bool,
) -> Result<Vec<PlanRow>> {
    let mut rows = Vec::new();
    for group in &inventory.groups {
        rows.push(row(
            source,
            TrackerObject::Group(group.clone()),
            group_key(&group.id),
            group.parent.as_ref().map(group_key),
            sharing,
            team,
        )?);
    }
    for issue in &inventory.issues {
        rows.push(row(
            source,
            TrackerObject::Issue(Box::new(issue.clone())),
            issue.id.as_str().to_string(),
            issue
                .parent
                .as_ref()
                .map(|id| id.as_str().to_string())
                .or_else(|| issue.group.as_ref().or(issue.team.as_ref()).map(group_key)),
            sharing,
            team,
        )?);
    }
    // Replace-plan links parents as it stages rows. Missing parents are not
    // fabricated; cyclic provider relations are broken deterministically.
    let keys: HashSet<_> = rows.iter().map(|row| row.foreign_id.clone()).collect();
    for row in &mut rows {
        if row
            .parent_foreign_id
            .as_ref()
            .is_some_and(|parent| !keys.contains(parent))
        {
            row.parent_foreign_id = None;
        }
    }
    let mut ordered = Vec::new();
    let mut placed = HashSet::new();
    while !rows.is_empty() {
        let index = rows.iter().position(|row| {
            row.parent_foreign_id
                .as_ref()
                .is_none_or(|parent| placed.contains(parent))
        });
        let mut row = rows.remove(index.unwrap_or(0));
        if index.is_none() {
            row.parent_foreign_id = None;
        }
        placed.insert(row.foreign_id.clone());
        ordered.push(row);
    }
    if let Some(row) = ordered.first_mut() {
        let mut meta: TrackerMeta = serde_json::from_value(row.metadata.clone())?;
        meta.warnings = inventory.warnings.clone();
        row.metadata = serde_json::to_value(meta)?;
    }
    Ok(ordered)
}

fn row(
    source: ImportSource,
    object: TrackerObject,
    key: String,
    parent: Option<String>,
    sharing: NotionSharing,
    team: bool,
) -> Result<PlanRow> {
    let (kind, title, url) = match &object {
        TrackerObject::Issue(issue) => (
            if source == ImportSource::Jira {
                ImportKind::JiraIssue
            } else {
                ImportKind::Issue
            },
            issue.title.clone(),
            Some(issue.url.clone()),
        ),
        TrackerObject::Group(group) => (
            match (source, group.kind) {
                (ImportSource::Jira, GroupKind::Epic) => ImportKind::JiraEpic,
                (ImportSource::Jira, _) => ImportKind::JiraProject,
                _ => ImportKind::Project,
            },
            group.title.clone(),
            group.url.clone(),
        ),
    };
    let plan = NotionPlanItem {
        decision: None,
        reason: None,
        path: Vec::new(),
        rows: None,
        sample_titles: Vec::new(),
        task_fields: None,
        shared: sharing == NotionSharing::Team && team,
        shared_reason: None,
        shareable: team,
        already_imported: None,
    };
    Ok(PlanRow {
        kind,
        foreign_id: key,
        parent_foreign_id: parent,
        metadata: serde_json::to_value(TrackerMeta {
            title,
            url,
            warnings: Vec::new(),
            summary: None,
            plan,
            object,
        })?,
    })
}

pub(in crate::domain::service) fn link_existing(
    rows: &mut [PlanRow],
    copies: &[ImportEntity],
) -> Result<()> {
    for row in rows {
        let mut meta: TrackerMeta = serde_json::from_value(row.metadata.clone())?;
        if meta.plan.shared
            && let Some(copy) = copies.iter().find(|copy| {
                copy.foreign_id == row.foreign_id && copy.status == ImportStatus::Imported
            })
            && let (Some(entity_id), Some(entity_type)) = (&copy.entity_id, &copy.entity_type)
        {
            meta.plan.already_imported = Some(NotionAlreadyImported {
                by: copy.user_id.clone(),
                entity_id: entity_id.clone(),
                entity_type: entity_type.clone(),
            });
            meta.plan.decision = Some(NotionDecision::Copy);
            row.metadata = serde_json::to_value(meta)?;
        }
    }
    Ok(())
}

pub(in crate::domain::service) fn triage_items(
    rows: &[PlanRow],
    inventory: &Inventory,
) -> Result<Vec<triage::TriageItem>> {
    let mut items = Vec::new();
    for row in rows {
        let meta: TrackerMeta = serde_json::from_value(row.metadata.clone())?;
        let TrackerObject::Group(group) = meta.object else {
            continue;
        };
        if meta.plan.already_imported.is_some() {
            continue;
        }
        items.push(triage::TriageItem {
            key: row.foreign_id.clone(),
            kind: row.kind,
            title: group.title,
            path: group
                .parent
                .as_ref()
                .and_then(|parent| inventory.groups.iter().find(|group| &group.id == parent))
                .map(|group| vec![group.title.clone()])
                .unwrap_or_default(),
            children: inventory
                .issues
                .iter()
                .filter(|issue| issue.group.as_ref().or(issue.team.as_ref()) == Some(&group.id))
                .count(),
            table: None,
        });
    }
    Ok(items)
}

pub(in crate::domain::service) fn decide(
    rows: &[PlanRow],
    verdicts: &HashMap<String, triage::Verdict>,
    sharing: NotionSharing,
    team: bool,
) -> Result<Vec<PlanRow>> {
    let mut decided = Vec::new();
    let mut inherited: HashMap<String, triage::Verdict> = HashMap::new();
    for row in rows {
        let mut meta: TrackerMeta = serde_json::from_value(row.metadata.clone())?;
        let parent = row
            .parent_foreign_id
            .as_ref()
            .and_then(|parent| inherited.get(parent));
        let parent_blocks = parent.filter(|verdict| {
            matches!(
                verdict.decision,
                NotionDecision::Skip | NotionDecision::Hand
            )
        });
        let team_blocks = match &meta.object {
            TrackerObject::Issue(issue) => issue
                .team
                .as_ref()
                .and_then(|team| inherited.get(&group_key(team)))
                .filter(|verdict| {
                    matches!(
                        verdict.decision,
                        NotionDecision::Skip | NotionDecision::Hand
                    )
                }),
            TrackerObject::Group(_) => None,
        };
        let verdict = team_blocks
            .or(parent_blocks)
            .or_else(|| verdicts.get(&row.foreign_id))
            .or(parent)
            .cloned()
            .unwrap_or_else(|| triage::Verdict {
                key: row.foreign_id.clone(),
                decision: NotionDecision::Copy,
                reason: None,
                task_fields: None,
                shared: None,
                shared_reason: None,
            });
        let visibility = sharing::plan_sharing(sharing, &verdict, team);
        meta.plan.decision = Some(match verdict.decision {
            NotionDecision::Tasks => NotionDecision::Copy,
            decision => decision,
        });
        meta.plan.reason = verdict.reason.clone();
        meta.plan.shared = visibility.shared;
        meta.plan.shared_reason = visibility.reason;
        inherited.insert(row.foreign_id.clone(), verdict);
        let mut row = row.clone();
        row.metadata = serde_json::to_value(meta)?;
        decided.push(row);
    }
    Ok(decided)
}
