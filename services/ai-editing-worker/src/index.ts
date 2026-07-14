import './globals';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import endpoints from './endpoints';
import type { Bindings } from './env';

const app = new Hono<{ Bindings: Bindings }>();

// The web app calls /edit directly from the browser; auth is the document
// permission token in the body, so origins stay open.
app.use('*', cors());
app.route('/', endpoints);

export default app;
