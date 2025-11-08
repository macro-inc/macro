import { Router } from 'express';
import { handleIncomingJob } from '../controllers/job';

export function jobRoutes() {
  const router: Router = Router();

  /**
   * @swagger
   * /job:
   *   post:
   *     description: Handle incoming job
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               event:
   *                 type: string
   *               data:
   *                 type: object
   *                 additionalProperties: true
   *     responses:
   *       200:
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   */
  router.post('/', handleIncomingJob);
  return router;
}
