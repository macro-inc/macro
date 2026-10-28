function handler(event) {
  var request = event.request;
  var headers = request.headers;
  var host = '';
  if (headers.host && headers.host.value) {
    host = headers.host.value;
  }

  if (host.startsWith('chat')) {
    // remove "chat." or "chat-"
    let newHost = host.slice(5);

    // start with original uri
    let redirectUrl = 'https://' + newHost + '/app/?chat=true';

    return {
      statusCode: 302,
      statusDescription: 'Redirecting to chat',
      headers: {
        location: { value: redirectUrl },
      },
    };
  }

  var cookies = request.cookies;

  // Check for auth tokens (HttpOnly cookies are accessible in CloudFront Functions)
  var hasRefreshToken = cookies['__COOKIE_PREFIX__macro-refresh-token'];

  if ((!request.uri || request.uri === '/') && hasRefreshToken) {
    return {
      statusCode: 302,
      statusDescription: 'Redirecting to app',
      headers: {
        location: { value: '/app' },
      },
    };
  }

  // Check if the Host header starts with "www."
  if (host.slice(0, 4) === 'www.') {
    var nakedDomain = host.slice(4); // remove "www."
    var redirectUrl = 'https://' + nakedDomain + request.uri;

    // Process querystring using the provided method
    var qs = [];
    for (var key in request.querystring) {
      if (request.querystring[key].multiValue) {
        request.querystring[key].multiValue.forEach((mv) => {
          qs.push(key + '=' + mv.value);
        });
      } else {
        qs.push(key + '=' + request.querystring[key].value);
      }
    }

    if (qs.length > 0) {
      redirectUrl += '?' + qs.sort().join('&');
    }

    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: {
        location: { value: redirectUrl },
      },
    };
  }

  // Serve prerendered directory indexes without S3's add-trailing-slash 302.
  // The site is prerendered to `<route>/index.html` and served from the S3
  // *website* endpoint, which 302-redirects an extensionless path (e.g.
  // `/posts/linear-alternative`) to its trailing-slash form before serving the
  // index document. Crawlers, LLM fetchers, and link-preview bots that don't
  // follow redirects then see the redirect stub instead of the page — and our
  // canonical/og:url/sitemap all advertise the no-slash URL. Rewriting the URI
  // to the index.html object here makes S3 return the page directly with a 200,
  // no redirect. Runs only on the default (website-assets) behavior; `/app/*`,
  // `/.well-known/*`, and `resources*` use other origins without this function.
  var uri = request.uri;
  var lastSegment = uri.slice(uri.lastIndexOf('/') + 1);
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (lastSegment.indexOf('.') === -1) {
    request.uri = uri + '/index.html';
  }

  // If not "www.", continue as normal
  return request;
}
