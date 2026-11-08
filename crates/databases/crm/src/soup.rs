//! Conversions from CRM records into their Soup wire shapes.

use crate::domain::model::{CrmCompanyForSoup, CrmContactForSoup, CrmDomain};
use soup_types::{
    crm_company::{SoupCrmCompany, SoupCrmDomain},
    crm_contact::SoupCrmContact,
};

impl From<CrmDomain> for SoupCrmDomain {
    fn from(d: CrmDomain) -> Self {
        SoupCrmDomain {
            id: d.id,
            company_id: d.company_id,
            domain: d.domain,
            created_at: d.created_at,
        }
    }
}

impl From<CrmCompanyForSoup> for SoupCrmCompany<()> {
    fn from(c: CrmCompanyForSoup) -> Self {
        let CrmCompanyForSoup {
            company,
            name,
            description,
            viewed_at,
        } = c;
        SoupCrmCompany {
            id: company.id,
            team_id: company.team_id,
            name,
            description,
            email_sync: company.email_sync,
            hidden: company.hidden,
            created_at: company.created_at,
            updated_at: company.updated_at,
            viewed_at,
            domains: company
                .domains
                .into_iter()
                .map(SoupCrmDomain::from)
                .collect(),
            extra: (),
        }
    }
}

impl From<CrmContactForSoup> for SoupCrmContact<()> {
    fn from(value: CrmContactForSoup) -> Self {
        let contact = value.contact;
        Self {
            id: contact.id,
            team_id: value.team_id,
            company_id: contact.company_id,
            company_name: value.company_name,
            email: contact.email,
            name: contact.name,
            hidden: contact.hidden,
            first_interaction: contact.first_interaction,
            last_interaction: contact.last_interaction,
            created_at: contact.created_at,
            updated_at: contact.updated_at,
            viewed_at: value.viewed_at,
            extra: (),
        }
    }
}
