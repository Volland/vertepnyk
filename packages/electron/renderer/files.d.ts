/** The preload API as the renderer sees it (the preload's channels are untyped `unknown`; these are the shapes main sends). */
export interface DocumentFile {
  readonly path: string;
  readonly text: string;
}
export type OpenRequest =
  | { readonly kind: "open"; readonly path: string; readonly text: string }
  | { readonly kind: "new"; readonly format: "scxml" | "yaml" }
  | { readonly kind: "example" };

export interface VertepnykFiles {
  open(): Promise<DocumentFile | null>;
  openPath(path: string): Promise<DocumentFile>;
  save(path: string, text: string): Promise<{ path: string }>;
  saveAs(name: string, text: string): Promise<{ path: string } | null>;
  recent(): Promise<readonly string[]>;
  onFileChanged(cb: (change: DocumentFile) => void): () => void;
  watch(path: string): Promise<boolean>;
  unwatch(path: string): Promise<boolean>;
  onOpenRequest(cb: (request: OpenRequest) => void): () => void;
  setDirty(dirty: boolean): Promise<boolean>;
  confirm(options: { message: string; detail?: string; ok?: string; cancel?: string }): Promise<boolean>;
  onCommand(cb: (command: "save" | "save-as") => void): () => void;
}
