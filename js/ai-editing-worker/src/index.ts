import './globals';
import { Hono } from 'hono';
import endpoints from './endpoints';
import type { Bindings, EnvVariables } from './env';
import { envMiddleware } from './env';

const app = new Hono<{ Bindings: Bindings; Variables: EnvVariables }>();

app.use(envMiddleware);
app.route('/', endpoints);

export default app;
