import 'prismjs';
import { fireAndForget } from '@core/util/fireAndForget';

// Load Prism before the shared rich-reference graph evaluates language modules.
fireAndForget(import('./fixture'), 'contacts');
