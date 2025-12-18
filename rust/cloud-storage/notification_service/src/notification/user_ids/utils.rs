use anyhow::{Result, anyhow};

pub fn filter_sender_id_from_recipient_ids(
    sender_id: Option<&str>,
    recipient_ids: Option<&Vec<String>>,
) -> Result<Vec<String>> {
    let user_id = sender_id.ok_or(anyhow!("no sender id provided"))?;
    let mut recipient_ids = recipient_ids
        .ok_or(anyhow!("no recipient ids provided"))?
        .clone();
    recipient_ids.sort();
    recipient_ids.dedup();

    let filtered_user_ids = recipient_ids
        .iter()
        .filter(|id| user_id != *id)
        .cloned()
        .collect();

    Ok(filtered_user_ids)
}

#[cfg(test)]
mod tests {
    use macro_user_id::user_id::MacroUserIdStr;

    use super::*;

    #[test]
    fn test_filter_sender_id_success() -> Result<()> {
        let sender_id = Some("user1".to_string());
        let recipient_ids = Some(vec![
            "user1".to_string(),
            "user2".to_string(),
            "user3".to_string(),
        ]);
        let filtered = filter_sender_id_from_recipient_ids(
            sender_id.as_ref().map(|x| x.as_str()),
            recipient_ids.as_ref(),
        )?;
        assert_eq!(filtered, vec!["user2".to_string(), "user3".to_string()]);
        Ok(())
    }

    #[test]
    fn test_filter_sender_id_no_sender() {
        let recipient_ids = Some(vec!["user1".to_string(), "user2".to_string()]);
        let result = filter_sender_id_from_recipient_ids(None, recipient_ids.as_ref());
        assert!(result.is_err());
        if let Err(err) = result {
            assert_eq!(err.to_string(), "no sender id provided");
        }
    }

    #[test]
    fn test_filter_sender_id_no_recipients() {
        let sender_id = Some(MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap());
        let recipient_ids: Option<&Vec<String>> = None;
        let result = filter_sender_id_from_recipient_ids(
            sender_id.as_ref().map(|x| x.as_ref()),
            recipient_ids,
        );
        assert!(result.is_err());
        if let Err(err) = result {
            assert_eq!(err.to_string(), "no recipient ids provided");
        }
    }

    #[test]
    fn test_filter_duplicate_recipients() -> Result<()> {
        let sender_id = Some(MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap());
        let recipient_ids = Some(vec![
            "user2".to_string(),
            "user2".to_string(),
            "user2".to_string(),
        ]);
        let filtered = filter_sender_id_from_recipient_ids(
            sender_id.as_ref().map(|x| x.as_ref()),
            recipient_ids.as_ref(),
        )?;
        assert_eq!(filtered, vec!["user2".to_string()]);
        Ok(())
    }
}
