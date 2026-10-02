//! CRM: companies, the contacts who work there, and a pipeline of deals.

use super::{
    DatabaseTemplate, PERSON, SELECT, TemplateContext, TemplateIcon, TemplateId, board,
    create_column, create_table, insert_rows, link, number, option, options, table_view, text,
};
use models_databases::{ColumnId, ColumnKind, DatabaseOp, TableId};

pub(super) const TEMPLATE: DatabaseTemplate = DatabaseTemplate {
    id: TemplateId::Crm,
    name: "CRM",
    description: "Companies, their contacts, and deals on a board by stage.",
    icon: TemplateIcon::Handshake,
};

pub(super) fn ops(context: &TemplateContext) -> Vec<DatabaseOp> {
    let companies = TableId::new();
    let company_name = ColumnId::new();
    let website = ColumnId::new();
    let industry = ColumnId::new();
    let industries = options(&["Software", "Finance", "Healthcare", "Retail"]);
    let [software, finance, healthcare] = [&industries[0], &industries[1], &industries[2]];

    let contacts = TableId::new();
    let contact_name = ColumnId::new();
    let email = ColumnId::new();
    let contact_company = ColumnId::new();
    let contact_owner = ColumnId::new();

    let deals = TableId::new();
    let deal_name = ColumnId::new();
    let deal_company = ColumnId::new();
    let stage = ColumnId::new();
    let amount = ColumnId::new();
    let deal_owner = ColumnId::new();
    let stages = options(&["Lead", "Qualified", "Proposal", "Won", "Lost"]);
    let [lead, qualified, proposal] = [&stages[0], &stages[1], &stages[2]];

    let company = ColumnKind::Relation {
        database: context.database,
        table: companies,
    };
    vec![
        create_table(companies, "Companies"),
        create_column(companies, company_name, "Name", ColumnKind::Text, &[]),
        create_column(companies, website, "Website", ColumnKind::Link, &[]),
        create_column(companies, industry, "Industry", SELECT, &industries),
        insert_rows(
            companies,
            vec![
                vec![
                    text(company_name, "Northwind Labs"),
                    link(website, "https://northwind.example.com"),
                    option(industry, software),
                ],
                vec![
                    text(company_name, "Bluebird Capital"),
                    link(website, "https://bluebird.example.com"),
                    option(industry, finance),
                ],
                vec![
                    text(company_name, "Evergreen Health"),
                    link(website, "https://evergreen.example.com"),
                    option(industry, healthcare),
                ],
            ],
        ),
        create_table(contacts, "Contacts"),
        create_column(contacts, contact_name, "Name", ColumnKind::Text, &[]),
        create_column(contacts, email, "Email", ColumnKind::Text, &[]),
        create_column(contacts, contact_company, "Company", company, &[]),
        create_column(contacts, contact_owner, "Owner", PERSON, &[]),
        insert_rows(
            contacts,
            vec![
                vec![
                    text(contact_name, "Ada Park"),
                    text(email, "ada@northwind.example.com"),
                ],
                vec![
                    text(contact_name, "Sam Rivera"),
                    text(email, "sam@bluebird.example.com"),
                ],
                vec![
                    text(contact_name, "Noor Hassan"),
                    text(email, "noor@evergreen.example.com"),
                ],
            ],
        ),
        create_table(deals, "Deals"),
        create_column(deals, deal_name, "Name", ColumnKind::Text, &[]),
        create_column(deals, deal_company, "Company", company, &[]),
        create_column(deals, stage, "Stage", SELECT, &stages),
        create_column(deals, amount, "Amount", ColumnKind::Number, &[]),
        create_column(deals, deal_owner, "Owner", PERSON, &[]),
        insert_rows(
            deals,
            vec![
                vec![
                    text(deal_name, "Northwind annual plan"),
                    option(stage, proposal),
                    number(amount, 24000.0),
                ],
                vec![
                    text(deal_name, "Bluebird pilot"),
                    option(stage, qualified),
                    number(amount, 8000.0),
                ],
                vec![
                    text(deal_name, "Evergreen expansion"),
                    option(stage, lead),
                    number(amount, 15000.0),
                ],
            ],
        ),
        board(
            deals,
            "Pipeline",
            (stage, &stages),
            deal_name,
            &[deal_company, amount, deal_owner],
        ),
        table_view(deals, "Table"),
    ]
}
