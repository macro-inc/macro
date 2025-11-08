export const TEMP_FILE_PREFIX = 'temp_files/';

type AppConfig = {
  environment: string;
  port: number;
  logLevel: string;
  producerHost: string;
  pdfServiceUrl: string;
  docxServiceUrl: string;
  documentStorageServiceUrl: string;
  documentStorageServiceAuthKey: string;
  docStorageBucket: string;
  jobResponseLambda: string;
  databaseUrl: string;
  pdfPreprocessLambda: string;
};

let _config: AppConfig;

export function config(): AppConfig {
  if (!_config) {
    _config = createConfig();
  }

  return _config;
}

function createConfig(): AppConfig {
  const c = {
    environment: process.env.ENVIRONMENT ?? 'local',
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
    logLevel: process.env.LOG_LEVEL ?? 'debug',
    producerHost: process.env.PRODUCER_HOST ?? '0.0.0.0',
    pdfServiceUrl: process.env.PDF_SERVICE_URL ?? '',
    docxServiceUrl: process.env.DOCX_SERVICE_URL ?? '',
    documentStorageServiceUrl: process.env.DOCUMENT_STORAGE_SERVICE_URL ?? '',
    documentStorageServiceAuthKey:
      process.env.DOCUMENT_STORAGE_SERVICE_AUTH_KEY ?? '',
    docStorageBucket: process.env.DOC_STORAGE_BUCKET ?? '',
    jobResponseLambda: process.env.JOB_RESPONSE_LAMBDA ?? '',
    databaseUrl: process.env.DATABASE_URL ?? '',
    pdfPreprocessLambda: process.env.PDF_PREPROCESS_LAMBDA ?? '',
  };

  Object.keys(c).forEach((key) => {
    if (!c[key as keyof AppConfig] || c[key as keyof AppConfig] === '') {
      // Only throw an error if we are not in the test env
      if (process.env.NODE_ENV !== 'TEST')
        throw new Error(`Missing config value: ${key}`);
    }
  });

  return c;
}
