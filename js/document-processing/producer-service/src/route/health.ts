import { type NextFunction, type Response, Router } from 'express';
import { config } from '../config';

export function healthRoutes() {
  const router: Router = Router();

  /**
   * @swagger
   * /health:
   *   get:
   *     description: Health check
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
  router.get('/', async (req, res: Response, next: NextFunction) => {
    try {
      const consumerCheck = await fetch(
        `http://${config().consumerHost}:${config().consumerPort}/health`
      );
      if (!consumerCheck.ok) {
        throw new Error(`consumer returned ${consumerCheck.status}`);
      }
      res.json({ success: true });
      next();
    } catch (err) {
      req.logger.error('unable to fetch consumer host health', { error: err });
      res
        .status(500)
        .json({ error: true, message: 'unable to fetch consumer host health' });
    }
    next();
  });
  return router;
}
