import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Keep keyboard focus inside `ref` while `active`. On activate it sets initial
// focus (unless an autoFocus field inside already has it), cycles Tab /
// Shift+Tab within the dialog so focus can't escape into the dimmed background,
// and restores focus to whatever opened the dialog when it closes. Used by every
// modal so keyboard / screen-reader users aren't dropped into hidden content.
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean
) {
  useEffect(() => {
    if (!active) return;
    const el: HTMLElement | null = ref.current;
    if (!el) return;
    const node: HTMLElement = el; // non-null alias for use inside the closure
    const opener = document.activeElement as HTMLElement | null;

    const list = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) =>
          n.offsetWidth > 0 ||
          n.offsetHeight > 0 ||
          n === document.activeElement
      );

    // Only set initial focus if focus isn't already inside (preserves autoFocus).
    if (!node.contains(document.activeElement)) list()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = list();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey) {
        if (cur === first || !node.contains(cur)) {
          e.preventDefault();
          last.focus();
        }
      } else if (cur === last || !node.contains(cur)) {
        e.preventDefault();
        first.focus();
      }
    }

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      // Return focus to the control that opened the dialog (if still present).
      if (opener && typeof opener.focus === "function" && opener.isConnected) {
        opener.focus();
      }
    };
  }, [ref, active]);
}
