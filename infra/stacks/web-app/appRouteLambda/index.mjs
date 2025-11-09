
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const template = readFileSync(join(__dirname, 'index.html'), 'utf-8');
const PREVIEW_URL = process.env.PREVIEW_URL;

export const handler = async (event) => {
  const rawPath = event.rawPath;
  const fileName = rawPath.split('/').pop();
  // If the request is for a file or template is empty, returns 404
  if ((!rawPath.includes('@') && fileName.includes('.') && fileName !== 'index.html') || !template) {
    return {
      statusCode: '404',
      headers: {
        'Content-Type': 'text/html',
      },
      body: 'Not Found',
    };
  }

  const path = event.requestContext.http.path;
  try {
    // Get the document name from DSS
    const blockName = path.split('/')[2];
    if (blockName === 'chat' || blockName === 'channel') {
      return {
        statusCode: '200',
        headers: {
          'Content-Type': 'text/html',
        },
        body: template,
      };
    }
    const documentUuid = path.split('/')[3];
    const preview = await fetch(PREVIEW_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_ids: [documentUuid],
      }),
    });
    const previewResult = await preview.json();
    const documentName = previewResult.previews[0].document_name;
    const documentTitle = documentName ?? 'AI Workspace';
    // Update the html page title with the document name
    const body = template.replace(
      /<head[^>]*>/i,
      `<head><title>Macro - ${documentTitle}</title>`
    );

    // Return the response
    return {
      statusCode: '200',
      headers: {
        'Content-Type': 'text/html',
      },
      body,
    };
  } catch (error) {
    console.error('Error building response:', error);
    return {
      statusCode: '200',
      headers: {
        'Content-Type': 'text/html',
      },
      body: template,
    };
  }
}
