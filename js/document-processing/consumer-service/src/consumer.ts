import {
  JobStatus,
  type JobTypes,
  JobValidation,
} from '@macro-inc/document-processing-job-types';
import zmq, { type Socket } from 'zeromq';
import { handleConsolidate } from './handlers/docx/handleConsolidate';
import { handleDocxUpload } from './handlers/docx/handleDocxUpload';
import { handleSimpleCompare } from './handlers/docx/handleSimpleCompare';
import { handleCreateTempFile } from './handlers/generic/handleCreateTempFile';
import { handleExport } from './handlers/pdf/handleExport';
import { handlePasswordEncrypt } from './handlers/pdf/handlePassword';
import { handlePreprocess } from './handlers/pdf/handlePreprocess';
import { sendResponse, sendWSResponse } from './handlers/responseHandler';
import { macroDB } from './service/macrodbService';
import { getLogger } from './utils/logger';

let _consumer: Socket = zmq.socket('sub');
export function consumer() {
  return _consumer;
}

function logJobCompletion({
  jobId,
  event,
  userId,
  email,
  startTime,
}: {
  jobId: string;
  event: JobTypes;
  userId?: string;
  email?: string;
  startTime: number;
}) {
  const logger = getLogger();
  if (event !== 'ping') {
    logger.debug('event completed', {
      job_id: jobId,
      user_id: userId,
      email: email,
      job_type: event,
      time: performance.now() - startTime,
    });
  }
}

export function initializeConsumer(producerHost: string) {
  const logger = getLogger();
  _consumer = _consumer.connect(`tcp://${producerHost}:42069`);
  _consumer = _consumer.subscribe('');

  _consumer.on(
    'message',
    (
      event: string,
      jobId: string,
      userId: string,
      email: string,
      data: string
    ) => {
      handleJob({
        event: event.toString() as JobTypes,
        jobId: jobId.toString(),
        // userId can be '' if not provided
        userId: userId.toString() || undefined,
        // email can be '' if not provided
        email: email.toString() || undefined,
        data: JSON.parse(data),
      }).catch((err) => {
        logger.error('error handling job', {
          job_id: jobId,
          user_id: userId,
          email: email,
          event: event,
          data,
          error: err,
        });
      });
    }
  );

  logger.info('Consumer connected to port 42069');
}

export async function handleJob({
  event,
  jobId,
  userId,
  email,
  data,
}: {
  event: JobTypes;
  jobId: string;
  userId?: string;
  email?: string;
  data: { [name: string]: any };
}) {
  const logger = getLogger();
  const startTime = performance.now();
  if (event !== 'ping') {
    logger.info('event received', {
      job_type: event,
      job_id: jobId,
      user_id: userId,
      data,
    });
  }
  try {
    if (JobValidation[event] === undefined) {
      throw new Error(`event ${event} not supported`);
    }

    sendWSResponse({
      jobId,
      jobStatus: JobStatus.Started,
      message: 'job started',
    }).catch((err) => {
      logger.error('unable to send WS response', {
        error: err,
        job_id: jobId,
        user_id: userId,
        job_type: event,
        data,
      });
    });

    if (email) {
      const user = await macroDB.user.findUnique({
        where: { email: email },
        select: { id: true },
      });
      if (user) {
        logger.debug('found user', { userId: user.id, email });
        userId = user.id;
      }
    }

    switch (event) {
      case 'ping':
        sendResponse({
          event: 'ping',
          jobId,
          data: { pong: true },
        });
        break;
      case 'pdf_preprocess':
        handlePreprocess(jobId, JobValidation[event](data), userId)
          .finally(() => logJobCompletion({ jobId, event, userId, startTime }))
          .catch((err) =>
            handleCatchError(event, jobId, err, data, userId, email)
          );
        break;
      case 'pdf_export':
        handleExport(jobId, JobValidation[event](data), userId)
          .finally(() => logJobCompletion({ jobId, event, userId, startTime }))
          .catch((err) =>
            handleCatchError(event, jobId, err, data, userId, email)
          );
        break;
      case 'pdf_password_encrypt':
        handlePasswordEncrypt(jobId, JobValidation[event](data), userId)
          .finally(() => logJobCompletion({ jobId, event, userId, startTime }))
          .catch((err) =>
            handleCatchError(event, jobId, err, data, userId, email)
          );
        break;
      case 'docx_simple_compare':
        if (!userId) {
          throw new Error('userId is requried for docx_simple_compare');
        }
        handleSimpleCompare(jobId, userId, JobValidation[event](data))
          .finally(() => logJobCompletion({ jobId, event, userId, startTime }))
          .catch((err) =>
            handleCatchError(event, jobId, err, data, userId, email)
          );
        break;
      case 'docx_consolidate':
        if (!userId) {
          throw new Error('userId is requried for docx_consolidate');
        }
        handleConsolidate(jobId, userId, JobValidation[event](data))
          .finally(() => logJobCompletion({ jobId, event, userId, startTime }))
          .catch((err) =>
            handleCatchError(event, jobId, err, data, userId, email)
          );
        break;
      case 'create_temp_file':
        handleCreateTempFile(jobId, JobValidation[event](data))
          .finally(() => logJobCompletion({ jobId, event, userId, startTime }))
          .catch((err) =>
            handleCatchError(event, jobId, err, data, userId, email)
          );
        break;
      case 'docx_upload':
        if (!userId) {
          throw new Error('userId is requried for docx_upload');
        }
        handleDocxUpload(jobId, userId, JobValidation[event](data))
          .finally(() => logJobCompletion({ jobId, event, userId, startTime }))
          .catch((err) =>
            handleCatchError(event, jobId, err, data, userId, email)
          );
        break;
      default:
        throw new Error(`event ${event} not supported`);
    }
  } catch (err) {
    // Handle catching any thrown errors we do not correctly catch
    handleCatchError(event, jobId, err, data, userId);
  }
}

function handleCatchError(
  event: JobTypes,
  jobId: string,
  error: any,
  data?: any,
  userId?: string,
  email?: string
) {
  const logger = getLogger();
  logger.error(`job processing exception occurred`, {
    job_id: jobId,
    job_type: event,
    user_id: userId,
    email: email,
    data,
    error,
  });
  sendResponse({
    event,
    jobId,
    error: true,
    message: error.toString(),
  });
}
