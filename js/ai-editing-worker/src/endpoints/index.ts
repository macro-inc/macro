import { Hono } from 'hono';
import type { Bindings } from '../env';
import edit from './edit';

const endpoints = new Hono<{ Bindings: Bindings }>();

endpoints.route('/edit', edit);

export default endpoints;
