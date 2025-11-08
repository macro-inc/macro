import cors from 'cors';
import express, {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from 'express';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { initializeConsumer } from './consumer';
import {
  error_handler,
  log_end,
  log_start,
  validateRequestHandler,
  // rateLimitHandler,
} from './middleware';
import { initializeProducer } from './producer';
import { healthRoutes, jobRoutes } from './route';
import { lambdaClient } from './service/lambdaService';
import { openapiSpecification } from './swagger';
import { Logger, getLogger } from './utils/logger';
// import { rateLimitService } from './service/rateLimitService';

// Setup app config
const appConfig = config();

// Setup logger
const logger = new Logger({
  logLevel: appConfig.logLevel,
});

getLogger(logger);
initializeProducer();
initializeConsumer(appConfig.consumerHost);
lambdaClient(appConfig.jobResponseLambda, logger);
// rateLimitService(
//   appConfig.rateLimitConfig,
//   appConfig.redisHost,
//   appConfig.redisPort,
//   logger,
// );

function createServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  app.disable('x-powered-by');
  const corsOptions = {
    credentials: true,
    origin: true,
    exposedHeaders: ['Retry-After'],
  };
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpecification));

  // Attach logger to request
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.logger = logger;
    next();
  });
  // Log start of request
  app.use(log_start);
  app.use('/health', healthRoutes());

  const jobRouter = Router();
  jobRouter.use(
    '/job',
    // Validates the request against schema using zod
    validateRequestHandler,
    // Rate limit the request
    // rateLimitHandler,
    // Routes the request through to send to consumer service for processing
    jobRoutes()
  );
  app.use(jobRouter);
  // Log end of request
  app.use(log_end);
  app.use(error_handler);
  app.listen(appConfig.port, () => {
    logger.info(`Running on port ${appConfig.port}`);
  });
}

createServer();
