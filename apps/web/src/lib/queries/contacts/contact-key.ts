import { v5 as uuidv5 } from 'uuid';

// RFC UUID OID namespace, identical to uuid::Uuid::NAMESPACE_OID. The JS
// library exposes DNS/URL constants but not OID.
const OID_NAMESPACE = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';

/** Cache address only, never membership proof. Inputs must be canonical user
 * IDs. Kept in lockstep with contacts::ContactId::for_viewer by shared fixtures. */
export function contactRecordKey(viewer: string, userId: string): string {
  return `GraphqlContact:${uuidv5(userId, uuidv5(viewer, OID_NAMESPACE))}`;
}
