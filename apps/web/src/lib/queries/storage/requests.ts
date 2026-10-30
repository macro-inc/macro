import { storageServiceClient } from '@service-storage/client';

export const fetchDocumentBranchName: typeof storageServiceClient.getDocumentBranchName =
  (...args) => storageServiceClient.getDocumentBranchName(...args);

export const fetchDocumentShortId: typeof storageServiceClient.getDocumentShortId =
  (...args) => storageServiceClient.getDocumentShortId(...args);

export const fetchSoupItems: typeof storageServiceClient.getSoupItems = (
  ...args
) => storageServiceClient.getSoupItems(...args);

export const fetchSoupAstItems: typeof storageServiceClient.getSoupAstItems = (
  ...args
) => storageServiceClient.getSoupAstItems(...args);

export const requestDocumentMetadata: typeof storageServiceClient.getDocumentMetadata =
  (...args) => storageServiceClient.getDocumentMetadata(...args);

export const createDocumentAnchor: typeof storageServiceClient.annotations.createAnchor =
  (...args) => storageServiceClient.annotations.createAnchor(...args);

export const deleteDocumentAnchor: typeof storageServiceClient.annotations.deleteAnchor =
  (...args) => storageServiceClient.annotations.deleteAnchor(...args);

export const editDocumentAnchor: typeof storageServiceClient.annotations.editAnchor =
  (...args) => storageServiceClient.annotations.editAnchor(...args);

export const fetchDocumentProcessingResult: typeof storageServiceClient.getDocumentProcessingResult =
  (...args) => storageServiceClient.getDocumentProcessingResult(...args);

export const fetchJobProcessingResult: typeof storageServiceClient.getJobProcessingResult =
  (...args) => storageServiceClient.getJobProcessingResult(...args);

export const savePdf: typeof storageServiceClient.pdfSave = (...args) =>
  storageServiceClient.pdfSave(...args);

export const deleteDocumentViewLocation: typeof storageServiceClient.deleteDocumentViewLocation =
  (...args) => storageServiceClient.deleteDocumentViewLocation(...args);

export const upsertDocumentViewLocation: typeof storageServiceClient.upsertDocumentViewLocation =
  (...args) => storageServiceClient.upsertDocumentViewLocation(...args);

export const requestProject: typeof storageServiceClient.projects.getProject = (
  ...args
) => storageServiceClient.projects.getProject(...args);

export const requestTextDocument = (
  ...args: Parameters<typeof storageServiceClient.getTextDocument>
): ReturnType<typeof storageServiceClient.getTextDocument> =>
  storageServiceClient.getTextDocument(...args);

export const ensureCollabSurface: typeof storageServiceClient.collabSurfaces.ensure =
  (...args) => storageServiceClient.collabSurfaces.ensure(...args);

export const fetchDocumentPermissions: typeof storageServiceClient.getDocumentPermissions =
  (...args) => storageServiceClient.getDocumentPermissions(...args);

export const fetchProjectPermissions: typeof storageServiceClient.projects.getPermissions =
  (...args) => storageServiceClient.projects.getPermissions(...args);

export const fetchChannelPreviews: typeof storageServiceClient.getBatchChannelPreviews =
  (...args) => storageServiceClient.getBatchChannelPreviews(...args);

export const editDocument: typeof storageServiceClient.editDocument = (
  ...args
) => storageServiceClient.editDocument(...args);

export const editProject: typeof storageServiceClient.projects.edit = (
  ...args
) => storageServiceClient.projects.edit(...args);

export const editThread: typeof storageServiceClient.editThread = (...args) =>
  storageServiceClient.editThread(...args);

export const fetchCompany: typeof storageServiceClient.getCompany = (...args) =>
  storageServiceClient.getCompany(...args);
export const fetchContact: typeof storageServiceClient.getContact = (...args) =>
  storageServiceClient.getContact(...args);
export const fetchCrmPipeline: typeof storageServiceClient.getCrmPipeline = (
  ...args
) => storageServiceClient.getCrmPipeline(...args);
