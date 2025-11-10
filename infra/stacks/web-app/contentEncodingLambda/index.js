exports.handler = (event, _context, callback) => {
  const response = event.Records[0].cf.response;
  const headers = response.headers;
  const request = event.Records[0].cf.request;

  if (
    request.uri.includes('soffice') &&
    (request.uri.endsWith('.wasm') ||
      request.uri.endsWith('.data') ||
      request.uri.endsWith('.patch'))
  ) {
    headers['content-encoding'] = [{ key: 'Content-Encoding', value: 'br' }];
  }

  callback(null, response);
};
