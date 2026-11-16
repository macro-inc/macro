use super::*;
use entity_access::domain::ports::AccessRepository;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn member_crm_revocation_keeps_individual_pipeline_grants(pool: PgPool) {
    let (s, _, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    s.share(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        PipelineSharing::Team,
    )
    .await
    .unwrap();
    write(&s, &a, &p, vec![insert(&p, company)]).await.unwrap();
    let audience = PgAccessRepository::new(pool.clone());
    assert!(
        audience
            .get_entity_users(&p.id, EntityType::CrmPipeline)
            .await
            .unwrap()
            .contains(&user(MEMBER))
    );
    // Warm the same service's sharing sources before revocation.
    assert_eq!(s.list(team_receipt(team, MEMBER)).await.unwrap().len(), 1);
    let keys = vec![(EntityType::CrmPipeline, p.id.to_string())];
    assert_eq!(
        a.visible_crm_entities(&user(MEMBER), &keys)
            .await
            .unwrap()
            .len(),
        1
    );
    sqlx::query!(
        "UPDATE team_user SET crm_access = false WHERE team_id = $1 AND user_id = $2",
        team,
        MEMBER
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(s.list(team_receipt(team, MEMBER)).await.unwrap().is_empty());
    assert!(
        a.visible_crm_entities(&user(MEMBER), &keys)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        !audience
            .get_entity_users(&p.id, EntityType::CrmPipeline)
            .await
            .unwrap()
            .contains(&user(MEMBER))
    );
    assert!(
        audience
            .get_entity_grant_audiences(&[p.id], EntityType::CrmPipeline)
            .await
            .unwrap()
            .iter()
            .all(|group| !group.users.contains(&user(MEMBER)))
    );
    assert!(
        a.generate_entity_access_receipt::<ViewAccessLevel>(
            &user(MEMBER),
            None,
            &p.id.to_string(),
            EntityType::CrmPipeline
        )
        .await
        .is_err()
    );
    assert!(
        s.create(
            team_receipt(team, MEMBER),
            CreatePipeline {
                name: "Denied".into(),
                record_type: None,
                sharing: PipelineSharing::Private
            }
        )
        .await
        .is_err()
    );
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'crm_pipeline', $2, 'user', 'view')", p.id, MEMBER).execute(&pool).await.unwrap();
    assert_eq!(s.list(team_receipt(team, MEMBER)).await.unwrap().len(), 1);
    assert_eq!(
        a.visible_crm_entities(&user(MEMBER), &keys)
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(
        audience
            .get_entity_users(&p.id, EntityType::CrmPipeline)
            .await
            .unwrap()
            .contains(&user(MEMBER))
    );
    assert!(
        audience
            .get_entity_grant_audiences(&[p.id], EntityType::CrmPipeline)
            .await
            .unwrap()
            .iter()
            .any(|group| group.users.contains(&user(MEMBER)))
    );
    let receipt = a
        .generate_entity_access_receipt::<ViewAccessLevel>(
            &user(MEMBER),
            None,
            &p.id.to_string(),
            EntityType::CrmPipeline,
        )
        .await
        .unwrap();
    assert!(s.get(receipt).await.is_ok());
    assert!(
        a.generate_entity_access_receipt::<ViewAccessLevel>(
            &user(MEMBER),
            None,
            &company.to_string(),
            EntityType::CrmCompany
        )
        .await
        .is_err()
    );
    sqlx::query!(
        "UPDATE team_user SET crm_access = true WHERE team_id = $1 AND user_id = $2",
        team,
        MEMBER
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        a.generate_entity_access_receipt::<EditAccessLevel>(
            &user(MEMBER),
            None,
            &p.id.to_string(),
            EntityType::CrmPipeline
        )
        .await
        .is_ok()
    );
}
