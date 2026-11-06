import { Hono } from 'hono';
import type { Bindings } from '../env';
import canvas from './canvas';
import commentMark from './comment-mark';
import edit from './edit';
import forms from './forms';
import spreadsheet from './spreadsheet';
import traces from './traces';

const endpoints = new Hono<{ Bindings: Bindings }>();

endpoints.route('/edit', edit);
endpoints.route('/canvas', canvas);
endpoints.route('/forms', forms);
endpoints.route('/comment-mark', commentMark);
endpoints.route('/traces', traces);
endpoints.route('/spreadsheet', spreadsheet);

export default endpoints;
