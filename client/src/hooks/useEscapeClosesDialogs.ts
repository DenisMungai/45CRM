import { useEffect } from "react";

/**
 * The dashboard's own modals (record editor, invoice/quote views, project work, renewals, profile…)
 * are plain elements rather than Radix dialogs, so Escape did nothing. On Escape this presses the
 * close button (or Cancel) of the top-most open dialog, which runs that dialog's normal close path.
 */
export function useEscapeClosesDialogs() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter((dialog) => !dialog.classList.contains("notify-panel"));
      const top = dialogs[dialogs.length - 1];
      if (!top) return;
      const close = top.querySelector<HTMLButtonElement>(":scope > .record-dialog-head .record-close, .record-close")
        ?? Array.from(top.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "Cancel");
      if (!close || close.disabled) return;
      event.preventDefault();
      close.click();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
