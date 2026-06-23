import "./globals";
import { Hono } from "hono";
import type { Bindings, EnvVariables } from "./env";
import { envMiddleware } from "./env";
import endpoints from "./endpoints";

const app = new Hono<{ Bindings: Bindings; Variables: EnvVariables }>();

app.use(envMiddleware);
app.route("/", endpoints);

export default app;
