export { healthRoutes } from './health';
export { jobRoutes } from './job';

/**
 *  @swagger
 *  components:
 *    responses:
 *      UnauthorizedError:
 *        description: User does not have permission to perform the call
 *        content:
 *        string:
 *          schema:
 *            type: string
 *      NotFoundError:
 *        description: Could not find necessary data
 *        content:
 *        string:
 *          schema:
 *            type: string
 *      TooManyRequestsError:
 *        description: Rate Limit Exceeded
 *        content:
 *        string:
 *          schema:
 *            type: string
 *      ServerError:
 *        description: Unknown error
 *        content:
 *        string:
 *          schema:
 *            type: string
 */
