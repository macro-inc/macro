import { documentStorageService } from '../service/documentStorageService';
import { getLogger } from '../utils/logger';

/**
 * @description Validates that the user has permission to view the document
 * @throws Error in the event something unexpected occurs
 */
export async function validateDocumentPermission(
  documentId: string,
  userId?: string,
  metadata?: { [name: string]: any }
) {
  const logger = getLogger();
  const userAccessLevel =
    await documentStorageService().get_document_user_access_level(
      documentId,
      userId ?? ''
    );

  logger.debug('got document user access level', {
    document_id: documentId,
    user_id: userId,
    permissions: userAccessLevel,
  });

  if ('error' in userAccessLevel) {
    logger.error('unable to get document user access level', {
      document_id: documentId,
      user_id: userId,
      error: userAccessLevel.error,
      message: userAccessLevel.message,
      ...metadata,
    });
    throw new Error('unable to get document user access level');
  }

  // If any user access level is returned, the user will have at least view access
  return true;
}
