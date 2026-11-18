import 'prismjs';

// Load Prism before the shared rich-reference graph evaluates language modules.
import('./fixture').catch((error) => console.error(error));
