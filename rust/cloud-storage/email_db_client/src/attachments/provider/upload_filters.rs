/// only insert attachments with these mime types.
pub const ATTACHMENT_MIME_TYPE_FILTERS: &str = r#"
    AND (
        a.mime_type IN (
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'text/html',
            'text/plain',
            'pdf'
        )
        OR (
            a.mime_type = 'application/octet-stream' 
            AND UPPER(SUBSTRING(a.filename FROM '\.([^.]+)$')) IN ('PDF', 'DOC', 'DOCX', 'TXT', 'HTML')
        )
    )
"#;

/// always insert attachments sent from these domains.
pub const ATTACHMENT_WHITELISTED_DOMAINS: &str = r#"
                        OR (
                            -- condition 4: email from whitelisted domain
                            c.email_address IS NOT NULL
                            AND (
                                c.email_address LIKE '%@docusign.com'
                                OR c.email_address LIKE '%@hellosign.com'
                                OR c.email_address LIKE '%@dropboxsign.com'
                                OR c.email_address LIKE '%@adobesign.com'
                                OR c.email_address LIKE '%@signnow.com'
                                OR c.email_address LIKE '%@pandadoc.com'
                                OR c.email_address LIKE '%@quickbooks.com'
                                OR c.email_address LIKE '%@xero.com'
                                OR c.email_address LIKE '%@stripe.com'
                                OR c.email_address LIKE '%@paypal.com'
                                OR c.email_address LIKE '%@squareup.com'
                                OR c.email_address LIKE '%@bill.com'
                                OR c.email_address LIKE '%@gusto.com'
                                OR c.email_address LIKE '%@justworks.com'
                                OR c.email_address LIKE '%@rippling.com'
                                OR c.email_address LIKE '%@intuit.com'
                                OR c.email_address LIKE '%@chase.com'
                                OR c.email_address LIKE '%@bankofamerica.com'
                                OR c.email_address LIKE '%@wellsfargo.com'
                                OR c.email_address LIKE '%@capitalone.com'
                                OR c.email_address LIKE '%@amex.com'
                                OR c.email_address LIKE '%@citibank.com'
                                OR c.email_address LIKE '%@robinhood.com'
                                OR c.email_address LIKE '%@etrade.com'
                                OR c.email_address LIKE '%@fidelity.com'
                                OR c.email_address LIKE '%@schwab.com'
                                OR c.email_address LIKE '%@interactivebrokers.com'
                                OR c.email_address LIKE '%@vanguard.com'
                                OR c.email_address LIKE '%@plaid.com'
                                OR c.email_address LIKE '%@irs.gov'
                                OR c.email_address LIKE '%@ssa.gov'
                                OR c.email_address LIKE '%@uscis.gov'
                                OR c.email_address LIKE '%@treasury.gov'
                                OR c.email_address LIKE '%@efiletexas.gov'
                                OR c.email_address LIKE '%@efilemanager.com'
                                OR c.email_address LIKE '%@efile.ca.gov'
                                OR c.email_address LIKE '%@sec.gov'
                                OR c.email_address LIKE '%@greenhouse.io'
                                OR c.email_address LIKE '%@lever.co'
                                OR c.email_address LIKE '%@bamboohr.com'
                                OR c.email_address LIKE '%@workday.com'
                                OR c.email_address LIKE '%@sap.com'
                                OR c.email_address LIKE '%@indeed.com'
                                OR c.email_address LIKE '%@linkedin.com'
                                OR c.email_address LIKE '%@ziprecruiter.com'
                                OR c.email_address LIKE '%@docusign.net'
                                OR c.email_address LIKE '%@dropbox.com'
                                OR c.email_address LIKE '%@box.com'
                                OR c.email_address LIKE '%@drive.google.com'
                                OR c.email_address LIKE '%@sharepoint.com'
                                OR c.email_address LIKE '%@onedrive.live.com'
                                OR c.email_address LIKE '%@wetransfer.com'
                                OR c.email_address LIKE '%@figma.com'
                                OR c.email_address LIKE '%@canva.com'
                                OR c.email_address LIKE '%@notion.so'
                                OR c.email_address LIKE '%@clickup.com'
                                OR c.email_address LIKE '%@airtable.com'
                                OR c.email_address LIKE '%@unitedhealthcare.com'
                                OR c.email_address LIKE '%@aetna.com'
                                OR c.email_address LIKE '%@cigna.com'
                                OR c.email_address LIKE '%@metlife.com'
                                OR c.email_address LIKE '%@anthem.com'
                                OR c.email_address LIKE '%@oscarhealth.com'
                                OR c.email_address LIKE '%@delta-dental.com'
                                OR c.email_address LIKE '%@vanguardbenefits.com'
                                OR c.email_address LIKE '%@fidelitybenefits.com'
                                OR c.email_address LIKE '%@aws.amazon.com'
                                OR c.email_address LIKE '%@cloudflare.com'
                                OR c.email_address LIKE '%@digitalocean.com'
                                OR c.email_address LIKE '%@github.com'
                                OR c.email_address LIKE '%@gitlab.com'
                                OR c.email_address LIKE '%@atlassian.com'
                                OR c.email_address LIKE '%@openai.com'
                                OR c.email_address LIKE '%@anthropic.com'
                            )
                        )"#;
