/**
 * The renderer's content security policy: nothing remote, scripts and workers from the app's own
 * origin, WebAssembly allowed for vertep. The same string is in `renderer/index.html` (a test
 * keeps them equal) and is sent as a header by the protocol handler.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");
