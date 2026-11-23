use item_filters::ast::EntityFilterAst;
use soup::domain::ports::NoOpSoupService;

use super::*;
use crate::test_support::{at, viewer};

/// A store whose every attention page is empty and resumes after its name,
/// so a page tells which store answered it.
struct Store(&'static str);

impl AttentionPages for Store {
    async fn attention_page(
        &self,
        _req: AttentionSoupRequest,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<AttentionSoupPage, SoupErr> {
        Ok(AttentionSoupPage {
            items: Vec::new(),
            next: Some(AttentionPagePosition {
                sort_at: at(1),
                entity_id: self.0.to_string(),
            }),
        })
    }
}

/// A viewer without inboxes.
struct NoInboxes;

impl ViewerInboxes for NoInboxes {
    async fn inbox_ids(&self, _user: &MacroUserIdStr<'static>) -> Result<Vec<Uuid>, Report> {
        Ok(Vec::new())
    }
}

fn request(read: CandidateRead) -> CandidateRequest {
    CandidateRequest {
        viewer: viewer(),
        keying: CandidateKeying::ThreadScoped,
        own_work: false,
        types: vec![EntityType::Channel],
        filter: EntityFilterAst::default(),
        limit: 10,
        after: None,
        only: None,
        assume_attention: false,
        read,
    }
}

/// The store that answered `read`, or the error it failed with.
async fn answered_by<S: SoupService, C: AttentionPages>(
    source: &SoupCandidateSource<S, NoInboxes, C>,
    read: CandidateRead,
) -> Result<String, String> {
    source
        .page(request(read))
        .await
        .map(|page| page.next.expect("the store names itself").entity_id)
        .map_err(|error| error.to_string())
}

#[tokio::test]
async fn committed_reads_go_to_the_committed_store_and_pages_to_the_replica() {
    // The replica here serves no attention pages, so a read it answers fails.
    let source = SoupCandidateSource::new(NoOpSoupService, Arc::new(NoInboxes))
        .with_committed_reads(Store("primary"));

    assert_eq!(
        answered_by(&source, CandidateRead::Committed).await,
        Ok("primary".to_string())
    );
    let replica = answered_by(&source, CandidateRead::Replica)
        .await
        .expect_err("the replica answers pages");
    assert!(
        replica.contains("does not serve attention feeds"),
        "{replica}"
    );
}

#[tokio::test]
async fn without_a_committed_store_committed_reads_use_the_one_store() {
    let source = SoupCandidateSource::new(NoOpSoupService, Arc::new(NoInboxes));

    for read in [CandidateRead::Replica, CandidateRead::Committed] {
        let error = answered_by(&source, read)
            .await
            .expect_err("the one store serves no attention pages");
        assert!(error.contains("does not serve attention feeds"), "{error}");
    }
}
