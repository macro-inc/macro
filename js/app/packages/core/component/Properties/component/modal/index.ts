// The selectors and entity utilities used to live under ./shared. They were
// physically moved into @property/editors/selectors; this barrel re-exports
// the public-facing helpers so callers that pulled them from the modal
// barrel keep working. Long-term, import directly from '@property'.
export {
  type CombinedEntity,
  createEntitySearchConfig,
  Dropdown,
  type DropdownOption,
  type EntityTypeItemMap,
  entityDataToEntity,
  entityTypeToBuckets,
  getEntityName,
  getEntitySearchText,
  getEntityTimestampedItem,
  getEntityType,
  isChannelEntity,
  PropertyDateSelector,
  PropertyEntitySelector,
  PropertyOptionSelector,
  quickAccessItemToEntity,
  sortEntitiesWithSelfFirst,
  threadMapper,
  useQuickAccessEntities,
  userToEntity,
} from '@property';
export { CreatePropertyModal } from './CreatePropertyModal';
export { EditPropertyValueModal } from './EditPropertyValueModal';
export { Modals } from './Modals';
export { SelectPropertyModal } from './SelectPropertyModal';
