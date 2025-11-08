import cors from 'cors';
import express, { type Response, Router, type NextFunction } from 'express';
import { config } from './config';
import { initializeConsumer } from './consumer';
import { initializeProducer } from './producer';
import { documentStorageService } from './service/documentStorageService';
import { docxService } from './service/docxService';
import { lambdaClient } from './service/lambdaService';
import { pdfService } from './service/pdfService';
import { s3Client } from './service/s3Service';
import { Logger } from './utils/logger';
import { getLogger } from './utils/logger';

// Setup app config
const appConfig = config();

// Setup logger
const logger = new Logger({
  logLevel: appConfig.logLevel,
});

getLogger(logger);
initializeProducer();
initializeConsumer(appConfig.producerHost);
s3Client(logger);
pdfService(appConfig.pdfServiceUrl, logger);
docxService(appConfig.docxServiceUrl, logger);
documentStorageService(
  appConfig.documentStorageServiceUrl,
  appConfig.documentStorageServiceAuthKey,
  logger
);
lambdaClient(
  {
    jobResponseLambda: appConfig.jobResponseLambda,
    pdfPreprocessLambda: appConfig.pdfPreprocessLambda,
  },
  logger
);

function createServer() {
  const app = express();
  app.use(express.json());
  app.disable('x-powered-by');
  const corsOptions = {
    credentials: true,
    origin: true,
    exposedHeaders: ['Retry-After'],
  };
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));

  const healthRouter = Router();
  healthRouter.get('/', (_, res: Response, next: NextFunction) => {
    res.json({ success: true });
    next();
  });
  app.use('/health', healthRouter);
  app.listen(appConfig.port, () => {
    logger.info(`Running on port ${appConfig.port}`);
  });
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
createServer();
