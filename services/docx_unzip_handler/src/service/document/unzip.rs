use sha2::{Digest, Sha256};

use std::io::{Cursor, Read};

use lambda_runtime::tracing;
use zip::ZipArchive;

use crate::models::DocumentBomPart;

#[tracing::instrument(skip(document_content))]
/// Create a list of document bom parts from a document key parts and a bucket.
pub fn unzip(document_content: Vec<u8>) -> Result<Vec<DocumentBomPart>, anyhow::Error> {
    let reader = Cursor::new(document_content);
    let mut zip = ZipArchive::new(reader)?;

    let mut document_bom_parts: Vec<DocumentBomPart> = Vec::new();

    for i in 0..zip.len() {
        let mut file = zip.by_index(i)?;
        if !file.is_file() {
            continue;
        }
        let mut file_contents = Vec::new();
        file.read_to_end(&mut file_contents)?;

        let mut hasher = Sha256::new();
        hasher.update(&file_contents);
        let result = hasher.finalize();
        let sha_hash = format!("{:x}", result);

        document_bom_parts.push(DocumentBomPart {
            sha: sha_hash,
            path: file.name().to_string(),
            content: file_contents,
        });
    }

    Ok(document_bom_parts)
}

#[cfg(test)]
mod tests {
    use crate::service::document::*;

    #[test]
    fn test_unzipping_docx_file() {
        // Load file into Vec<u8>
        let filename = "fixtures/documents/simple_test.docx";
        let bytes = match load_file_into_vec(filename) {
            Ok(bytes) => bytes,
            Err(e) => panic!("unable to load file into vec {:?}", e),
        };

        let result = unzip(bytes).unwrap();
        assert_eq!(result.len(), 9);
        let result_sha_paths: Vec<(&str, &str)> = result
            .iter()
            .map(|x| (x.sha.as_str(), x.path.as_str()))
            .collect();

        let expected_results: Vec<(&str, &str)> = vec![
            (
                "3f9af055bad60df35048352a876cf9087fe31caff17bd54e91d9e199187663a6",
                "word/numbering.xml",
            ),
            (
                "3e3c890f63189f99fa50f9ea41b1091bc6c1bf68a8b3192550750fd783e92a67",
                "word/settings.xml",
            ),
            (
                "2b0faa4babb89ade4e36a9c4e7b11d079e3338c420d3ee529f8bca4c0b759e09",
                "word/fontTable.xml",
            ),
            (
                "c76e511b60a9d6f24a805dd09e9766e1ccf89154c5cafe53daaca0b05c0354d6",
                "word/styles.xml",
            ),
            (
                "698dc19f251cc603b671fab8f0ed65084d7c3d6268629809ef3bb2b8d5cddaee",
                "word/document.xml",
            ),
            (
                "2f88ba313d7d77c73d3737c12338686a29f13f029e69a783e026da83a7dd891c",
                "word/_rels/document.xml.rels",
            ),
            (
                "1cc87395d4a229f21c23af406724de12dd9454071925f983e4b648a7b2be8cc5",
                "_rels/.rels",
            ),
            (
                "b2295d3198893d2c03f5e584c749a15751b798aefdcd9bee2889f13903d68cb2",
                "word/theme/theme1.xml",
            ),
            (
                "9d7f255ed84faae5156ffbc07a2ecad62329996649f4f9c4320095f131d5a2bd",
                "[Content_Types].xml",
            ),
        ];
        assert_eq!(result_sha_paths, expected_results);
    }
}
