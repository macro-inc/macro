// Map file extension to MIME type
export const getMimeType = (ext: string) => {
  switch (ext.toLowerCase()) {
    case '.txt':
      return 'text/plain';
    case '.js':
      return 'application/javascript';
    case '.jsx':
      return 'text/jsx';
    case '.ts':
      return 'application/typescript';
    case '.tsx':
      return 'text/tsx';
    case '.json':
      return 'application/json';
    case '.html':
      return 'text/html';
    case '.css':
      return 'text/css';
    case '.md':
      return 'text/markdown';
    case '.py':
      return 'text/x-python';
    case '.java':
      return 'text/x-java-source';
    case '.c':
      return 'text/x-c';
    case '.cpp':
      return 'text/x-c++';
    case '.rs':
      return 'text/rust';
    case '.go':
      return 'text/x-go';
    case '.rb':
      return 'text/ruby';
    case '.php':
      return 'application/x-httpd-php';
    case '.sql':
      return 'application/sql';
    case '.xml':
      return 'application/xml';
    case '.yaml':
    case '.yml':
      return 'application/x-yaml';
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'text/plain';
  }
};
