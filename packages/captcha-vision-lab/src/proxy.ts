/**
 * Proxy variables in the environment. The lab refuses to run with any: Bun
 * may send even loopback requests through an operator's proxy, and the lab's
 * requests carry the run capability and the challenge's pixels.
 */
export const proxyVariables = (): string[] =>
  Object.keys(process.env).filter((name) =>
    /^(?:https?|all)_proxy$/i.test(name)
  );
