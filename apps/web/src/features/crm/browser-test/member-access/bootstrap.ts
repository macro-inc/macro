import 'prismjs';

// The real workspace imports the same rich-reference graph as privacy fixtures.
import('./fixture').catch((error) => console.error(error));
