//! Vault ownership policy for membership departure; values never enter this flow.
use super::models::*;
use macro_user_id::user_id::MacroUserIdStr;

/// Whether the member chose to leave or access was administratively revoked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Departure {
    /// Refuse departure until the person disposes of every live owned item.
    Voluntary,
    /// Retire private items and transfer only already-shared items.
    Administrative,
}

/// Apply membership policy to one metadata record under the team vault lease.
pub fn depart_member(
    record: &mut Record,
    member: &MacroUserIdStr<'_>,
    owner: &MacroUserIdStr<'_>,
    departure: Departure,
) -> Result<(), Error> {
    use macro_user_id::cowlike::CowLike;
    let owned = record.user_id == *member;
    if owned && !record.deleting && departure == Departure::Voluntary {
        return Err(Error::OwnedItems);
    }
    record
        .grants
        .retain(|grant| !matches!(grant.kind, GranteeKind::User) || grant.id != member.as_ref());
    if owned && !record.deleting {
        if record.grants.is_empty() {
            record.deleting = true;
            record.totp_key_id = None;
            record.metadata.has_totp = false;
        } else {
            record.user_id = owner.clone().into_owned();
        }
    }
    record.metadata.shared = !record.grants.is_empty();
    record.metadata.share_count = record
        .grants
        .iter()
        .map(|grant| (matches!(grant.kind, GranteeKind::Team), grant.id.as_str()))
        .collect::<std::collections::HashSet<_>>()
        .len();
    Ok(())
}

#[cfg(test)]
mod test {
    use super::*;
    use macro_user_id::cowlike::CowLike;
    use uuid::Uuid;
    fn record() -> Record {
        let now = chrono::Utc::now();
        Record {
            user_id: MacroUserIdStr::parse_from_str("macro|member@example.test")
                .unwrap()
                .into_owned(),
            grants: vec![],
            deleting: false,
            member_removal_pending: false,
            revision: 1,
            totp_key_id: None,
            metadata: ItemMetadata {
                id: ItemId(Uuid::now_v7()),
                team_id: TeamId(Uuid::now_v7()),
                name: "Credential".into(),
                kind: ItemKind::Login,
                url: None,
                folder_id: None,
                favorite: false,
                version: 1,
                has_totp: false,
                shared: false,
                share_count: 0,
                created_at: now,
                updated_at: now,
                last_used_at: None,
            },
        }
    }
    #[test]
    fn voluntary_departure_cannot_abandon_live_owned_items() {
        let mut item = record();
        let member = item.user_id.clone();
        let owner = MacroUserIdStr::parse_from_str("macro|owner@example.test").unwrap();
        assert!(matches!(
            depart_member(&mut item, &member, &owner, Departure::Voluntary),
            Err(Error::OwnedItems)
        ));
        assert!(!item.deleting);
    }
    #[test]
    fn administrative_removal_never_transfers_private_values() {
        let mut item = record();
        let member = item.user_id.clone();
        let owner = MacroUserIdStr::parse_from_str("macro|owner@example.test").unwrap();
        item.grants.push(Grant {
            kind: GranteeKind::User,
            id: member.to_string(),
            permission: Permission::Edit,
        });
        depart_member(&mut item, &member, &owner, Departure::Administrative).unwrap();
        assert!(item.deleting);
        assert_eq!(item.user_id, member);
        assert!(item.grants.is_empty());
    }
    #[test]
    fn administrative_removal_preserves_shared_grants_and_drops_departed_members_grants() {
        let mut item = record();
        let member = item.user_id.clone();
        let owner = MacroUserIdStr::parse_from_str("macro|owner@example.test").unwrap();
        item.grants = vec![
            Grant {
                kind: GranteeKind::User,
                id: member.to_string(),
                permission: Permission::Edit,
            },
            Grant {
                kind: GranteeKind::User,
                id: "macro|viewer@example.test".into(),
                permission: Permission::View,
            },
        ];
        depart_member(&mut item, &member, &owner, Departure::Administrative).unwrap();
        assert!(!item.deleting);
        assert_eq!(item.user_id.as_ref(), owner.as_ref());
        assert_eq!(item.grants.len(), 1);
        assert_eq!(item.grants[0].id, "macro|viewer@example.test");
        assert!(matches!(item.grants[0].permission, Permission::View));
    }
}
