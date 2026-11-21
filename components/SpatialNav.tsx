"use client";

import { useEffect } from "react";

/**
 * Lightweight spatial navigation for keyboards, TV remotes and game controllers
 * (Xbox Edge, Chromebook keyboards). Arrow keys / D-pad move focus to the
 * nearest focusable element in that direction. With a gamepad, A activates and
 * B goes back. No dependencies, and it does nothing until an arrow key or
 * gamepad is used.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Dir = "up" | "down" | "left" | "right";

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function move(dir: Dir): boolean {
  const current = document.activeElement as HTMLElement | null;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el !== current && visible(el) && !el.closest("[inert]"),
  );
  if (!candidates.length) return false;

  if (!current || current === document.body) {
    // Start inside the page content rather than on the skip link or header.
    const first = candidates.find((el) => el.closest("main") && !el.classList.contains("skip-link")) ?? candidates[0];
    first.focus();
    return true;
  }

  const from = current.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = cx - fx;
    const dy = cy - fy;
    let primary: number;
    let secondary: number;
    switch (dir) {
      case "up":
        if (r.bottom > from.top + 2) continue;
        primary = -dy; secondary = Math.abs(dx); break;
      case "down":
        if (r.top < from.bottom - 2) continue;
        primary = dy; secondary = Math.abs(dx); break;
      case "left":
        if (r.right > from.left + 2) continue;
        primary = -dx; secondary = Math.abs(dy); break;
      case "right":
        if (r.left < from.right - 2) continue;
        primary = dx; secondary = Math.abs(dy); break;
    }
    // Favour elements that line up with the current one.
    const score = primary + secondary * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    return true;
  }
  return false;
}

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "range", "color"].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable;
}

export default function SpatialNav() {
  useEffect(() => {
    const keyMap: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const dir = keyMap[e.key];
      if (!dir) return;
      const active = document.activeElement;
      // Leave text editing and native selects alone, except vertical moves out of a text field.
      if (active instanceof HTMLSelectElement) return;
      if (isTextEntry(active) && (dir === "left" || dir === "right")) return;
      if (active?.closest('[role="radiogroup"],[data-sn-ignore]')) return;
      if (move(dir)) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);

    // ---- Gamepad (polled only while one is connected) ----
    let raf = 0;
    let last: Record<number, number> = {};
    const REPEAT_MS = 180;
    const btnDir: Record<number, Dir> = { 12: "up", 13: "down", 14: "left", 15: "right" };

    function poll() {
      const pads = navigator.getGamepads?.() ?? [];
      const now = performance.now();
      for (const pad of pads) {
        if (!pad) continue;
        const pressed = (i: number) => Boolean(pad.buttons[i]?.pressed);
        const fire = (id: number, fn: () => void) => {
          if (now - (last[id] ?? 0) > REPEAT_MS) {
            last[id] = now;
            fn();
          }
        };
        for (const [i, dir] of Object.entries(btnDir)) {
          if (pressed(Number(i))) fire(Number(i), () => move(dir));
        }
        const [ax = 0, ay = 0] = pad.axes;
        if (ay < -0.6) fire(100, () => move("up"));
        if (ay > 0.6) fire(101, () => move("down"));
        if (ax < -0.6) fire(102, () => move("left"));
        if (ax > 0.6) fire(103, () => move("right"));
        if (pressed(0)) fire(0, () => (document.activeElement as HTMLElement | null)?.click());
        if (pressed(1)) fire(1, () => history.back());
        // Release resets so a fresh press always fires immediately.
        for (const i of [0, 1, 12, 13, 14, 15]) if (!pressed(i)) delete last[i];
      }
      raf = requestAnimationFrame(poll);
    }
    function onConnect() {
      if (!raf) raf = requestAnimationFrame(poll);
    }
    function onDisconnect() {
      const any = (navigator.getGamepads?.() ?? []).some(Boolean);
      if (!any && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        last = {};
      }
    }
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
