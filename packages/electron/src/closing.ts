/** What closing a window does, given whether the document has unsaved edits. */
export type CloseChoice = "save" | "discard" | "cancel";
export type CloseOutcome = "close" | "save-then-close" | "stay";

export const CLOSE_BUTTONS = ["Save", "Don't Save", "Cancel"] as const;

/** Whether the window may close at once or must ask first. */
export function closeNeedsPrompt(state: { dirty: boolean; forced: boolean }): boolean {
  return state.dirty && !state.forced;
}

/** Maps the index of the pressed `CLOSE_BUTTONS` entry to a choice; anything unknown cancels. */
export function choiceOf(response: number): CloseChoice {
  return response === 0 ? "save" : response === 1 ? "discard" : "cancel";
}

export function outcomeOf(choice: CloseChoice): CloseOutcome {
  return choice === "save" ? "save-then-close" : choice === "discard" ? "close" : "stay";
}

/**
 * After the renderer reports its dirty state while a save-then-close is pending: close when the
 * save went through, otherwise abandon the close (the save was cancelled or failed).
 */
export function afterSaveReport(dirty: boolean): "close" | "abandon" {
  return dirty ? "abandon" : "close";
}
