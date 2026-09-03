type RuntimeBindings = Record<string, unknown>;

declare global {
  // Shared across bundled server chunks so Cloudflare bindings are still
  // available when a server function is loaded from a different chunk.
  var __CLOUDFLARE_RUNTIME_BINDINGS__: RuntimeBindings | undefined;
}

let workerBindings: RuntimeBindings = {};

/** Capture bindings passed to the Cloudflare Worker fetch entry point. */
export function setRuntimeBindings(bindings: unknown): void {
  if (bindings && typeof bindings === "object") {
    workerBindings = bindings as RuntimeBindings;
    globalThis.__CLOUDFLARE_RUNTIME_BINDINGS__ = workerBindings;
  }
}

/** Read a server secret in Node-compatible and Cloudflare deployments. */
export function getRuntimeSecret(name: string): string | undefined {
  let processValue: unknown;
  try {
    processValue = typeof process !== "undefined" ? process.env?.[name] : undefined;
  } catch {
    processValue = undefined;
  }
  if (typeof processValue === "string" && processValue.trim()) {
    return processValue.trim();
  }

  const bindings = globalThis.__CLOUDFLARE_RUNTIME_BINDINGS__ ?? workerBindings;
  const workerValue = bindings[name];
  return typeof workerValue === "string" && workerValue.trim()
    ? workerValue.trim()
    : undefined;
}
