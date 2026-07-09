import { Hono } from 'hono';
import type { Bindings } from '../env';
import edit from './edit';
import traces from './traces';

const endpoints = new Hono<{ Bindings: Bindings }>();

endpoints.route('/edit', edit);
endpoints.route('/traces', traces);

export default endpoints;
