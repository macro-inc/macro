// The selectors and entity utilities used to live under ./shared. They were
// physically moved into @property/editors/selectors; this barrel re-exports
// the public-facing helpers so callers that pulled them from the modal
// barrel keep working. Long-term, import directly from '@property'.
export {} from '@property';

export { Modals } from './Modals';
