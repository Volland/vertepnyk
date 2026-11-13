/**
 * The web host writes through a File System Access handle. In the desktop app the handle is a
 * thin object over the preload API: it writes to a known path with `save`, or, for an untitled
 * document, through the native save dialog (`saveAs`) on its first write.
 */
import type { VertepnykFiles } from "./files.js";

export interface PathHandle {
  readonly name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<File>;
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

export function fileHandleFor(files: VertepnykFiles, path: string): PathHandle {
  return {
    name: baseName(path),
    createWritable: async () => ({
      write: async (data) => {
        await files.save(path, data);
      },
      close: async () => undefined,
    }),
    getFile: async () => {
      const f = await files.openPath(path);
      return new File([f.text], baseName(f.path));
    },
  };
}

/**
 * Defines `showSaveFilePicker` so the web host's "Save as" (and the first save of an untitled
 * document) goes to the native dialog. `onSaved` receives the chosen path.
 */
export function installSavePicker(files: VertepnykFiles, onSaved: (path: string) => void): void {
  (window as unknown as { showSaveFilePicker: (o?: { suggestedName?: string }) => Promise<PathHandle> }).showSaveFilePicker = async (o) => {
    const suggested = o?.suggestedName ?? "untitled.scxml";
    let chosen: string | null = null;
    return {
      get name() {
        return chosen ? baseName(chosen) : suggested;
      },
      createWritable: async () => ({
        write: async (data) => {
          if (chosen) {
            await files.save(chosen, data);
            return;
          }
          const r = await files.saveAs(suggested, data);
          if (!r) throw new DOMException("The save dialog was cancelled", "AbortError");
          chosen = r.path;
          onSaved(r.path);
        },
        close: async () => undefined,
      }),
      getFile: async () => new File([""], suggested),
    };
  };
}
