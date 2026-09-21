import { Hono } from 'hono';
import type { Bindings } from '../env';
import edit from './edit';
import spreadsheet from './spreadsheet';
import traces from './traces';

const endpoints = new Hono<{ Bindings: Bindings }>();

endpoints.route('/edit', edit);
endpoints.route('/traces', traces);
endpoints.route('/spreadsheet', spreadsheet);

export default endpoints;
