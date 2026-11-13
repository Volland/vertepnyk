/** The webview content security policy: the extension's own scripts and WebAssembly only. */
// @tg: implements:: [[openspec:vscode-extension#VS Code distribution]]
/** The CSP of the webview; what each source is for is documented in the README. */
export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data: blob:`,
    `font-src ${cspSource}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    // only the nonce'd page module; workers are blobs of the extension's own scripts (worker-src)
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `worker-src ${cspSource} blob:`,
    `connect-src ${cspSource}`,
  ].join("; ");
}
