declare module "elkjs/lib/elk-worker.min.js" {
  /** elkjs's in-thread engine, constructed by the `workerFactory` of `elk-api`. */
  export const Worker: new (url?: string) => unknown;
  const _default: new (url?: string) => unknown;
  export default _default;
}
