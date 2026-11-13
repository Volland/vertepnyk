/** Undo history of text snapshots: each step restores the exact previous text. */
import type { TextPatch } from "./model.js";
import { composePatches } from "./text.js";

export interface UndoStep {
  readonly before: string;
  after: string;
  /** Patches against `before` that produce `after`. */
  patches: TextPatch[];
  readonly mergeKey: string | undefined;
}

export class UndoStack {
  private readonly done: UndoStep[] = [];
  private readonly undone: UndoStep[] = [];
  /** Whether the next push may merge into the top step (no undo/redo/external change since). */
  private open = false;

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** Record an edit; consecutive edits with the same merge key become one step. */
  push(before: string, after: string, patches: readonly TextPatch[], mergeKey?: string): void {
    this.undone.length = 0;
    const top = this.done[this.done.length - 1];
    if (this.open && mergeKey !== undefined && top && top.mergeKey === mergeKey && top.after === before) {
      top.patches = composePatches(top.before, top.patches, patches);
      top.after = after;
    } else {
      this.done.push({ before, after, patches: [...patches], mergeKey });
    }
    this.open = true;
  }

  undo(): UndoStep | undefined {
    const s = this.done.pop();
    if (s) this.undone.push(s);
    this.open = false;
    return s;
  }

  redo(): UndoStep | undefined {
    const s = this.undone.pop();
    if (s) this.done.push(s);
    this.open = false;
    return s;
  }

  /** Close the current merge group (an external change or explicit break). */
  seal(): void {
    this.open = false;
  }

  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
    this.open = false;
  }
}
