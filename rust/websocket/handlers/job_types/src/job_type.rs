use anyhow::{anyhow, Result};
use serde::Serialize;

#[derive(Debug, Eq, PartialEq, Hash, Clone, Serialize)]
pub enum JobType {
    Ping,
    CreateTempFile,
    PdfPreprocess,
    PdfModify,
    PdfPasswordDecrypt,
    PdfPasswordEncrypt,
    PdfRemoveMetadata,
    PdfExport,
    DocxSimpleCompare,
    DocxConsolidate,
    DocxCountRevisions,
    DocxUpload,
}

impl JobType {
    pub const VALUES: [JobType; 12] = [
        JobType::Ping,
        JobType::CreateTempFile,
        JobType::PdfPreprocess,
        JobType::PdfModify,
        JobType::PdfPasswordDecrypt,
        JobType::PdfPasswordEncrypt,
        JobType::PdfRemoveMetadata,
        JobType::PdfExport,
        JobType::DocxSimpleCompare,
        JobType::DocxConsolidate,
        JobType::DocxCountRevisions,
        JobType::DocxUpload,
    ];

    pub fn from_str(job_type: &str) -> Result<Self> {
        match job_type {
            "ping" => Ok(JobType::Ping),
            "create_temp_file" => Ok(JobType::CreateTempFile),
            "pdf_preprocess" => Ok(JobType::PdfPreprocess),
            "pdf_modify" => Ok(JobType::PdfModify),
            "pdf_password_decrypt" => Ok(JobType::PdfPasswordDecrypt),
            "pdf_password_encrypt" => Ok(JobType::PdfPasswordEncrypt),
            "pdf_remove_metadata" => Ok(JobType::PdfRemoveMetadata),
            "pdf_export" => Ok(JobType::PdfExport),
            "docx_simple_compare" => Ok(JobType::DocxSimpleCompare),
            "docx_consolidate" => Ok(JobType::DocxConsolidate),
            "docx_count_revisions" => Ok(JobType::DocxCountRevisions),
            "docx_upload" => Ok(JobType::DocxUpload),
            _ => Err(anyhow!("unsupported job type {}", job_type)),
        }
    }

    pub fn to_str(&self) -> &str {
        match self {
            JobType::Ping => "ping",
            JobType::CreateTempFile => "create_temp_file",
            JobType::PdfPreprocess => "pdf_preprocess",
            JobType::PdfModify => "pdf_modify",
            JobType::PdfPasswordDecrypt => "pdf_password_decrypt",
            JobType::PdfPasswordEncrypt => "pdf_password_encrypt",
            JobType::PdfRemoveMetadata => "pdf_remove_metadata",
            JobType::PdfExport => "pdf_export",
            JobType::DocxSimpleCompare => "docx_simple_compare",
            JobType::DocxConsolidate => "docx_consolidate",
            JobType::DocxCountRevisions => "docx_count_revisions",
            JobType::DocxUpload => "docx_upload",
        }
    }
}
