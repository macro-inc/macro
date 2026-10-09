import { Hono } from 'hono';
import type { Bindings } from '../env';
import codeMode from './code-mode';
import commentMark from './comment-mark';
import edit from './edit';
import spreadsheet from './spreadsheet';
import traces from './traces';

const endpoints = new Hono<{ Bindings: Bindings }>();

endpoints.route('/edit', edit);
endpoints.route('/comment-mark', commentMark);
endpoints.route('/traces', traces);
endpoints.route('/spreadsheet', spreadsheet);
endpoints.route('/code-mode', codeMode);

export default endpoints;
