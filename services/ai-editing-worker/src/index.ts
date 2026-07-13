import './globals';
import { Hono } from 'hono';
import endpoints from './endpoints';
import type { Bindings } from './env';

const app = new Hono<{ Bindings: Bindings }>();

app.route('/', endpoints);

export default app;
