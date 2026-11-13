"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Drag-and-drop ordering for card lists. The order is a per-browser preference kept in localStorage
 * (it never leaves the device and has no effect on server data or access rules).
 * Cards are dragged by their handle so text fields inside a card keep working normally.
 */
export function useSortable<T extends { _id: string }>(storageKey: string, items: T[] | undefined) {
  const [order, setOrder] = useState<string[]>([]);
  const [armed, setArmed] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`lendloop:order:${storageKey}`);
      if (saved) setOrder(JSON.parse(saved) as string[]);
    } catch {
      /* storage unavailable: fall back to the default order */
    }
  }, [storageKey]);

  // FLIP animation: remember where each card was, then let it fly from there to its new spot.
  const els = useRef(new Map<string, HTMLElement>());
  const prev = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches && document.documentElement.dataset.motion !== "on";
    els.current.forEach((el, id) => {
      if (!el.isConnected) {
        els.current.delete(id);
        prev.current.delete(id);
        return;
      }
      const now = { x: el.offsetLeft, y: el.offsetTop };
      const old = prev.current.get(id);
      if (old && !reduce && (old.x !== now.x || old.y !== now.y)) {
        el.animate(
          [
            { transform: `translate(${old.x - now.x}px, ${old.y - now.y}px) rotate(-3deg) scale(1.06)`, boxShadow: "0 18px 40px rgba(59,91,219,.35)", zIndex: 5 },
            { transform: "translate(0,0) rotate(0) scale(1)", boxShadow: "none", zIndex: 5 },
          ],
          { duration: 650, easing: "cubic-bezier(.2,.9,.3,1.25)" },
        );
      }
      prev.current.set(id, now);
    });
  });

  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ordered = items ? [...items].sort((a, b) => rank(a._id) - rank(b._id)) : undefined;

  function move(fromId: string, toId: string) {
    if (!ordered || fromId === toId) return;
    const before = ordered.map((t) => t._id);
    const movingForward = before.indexOf(fromId) < before.indexOf(toId);
    const ids = before.filter((id) => id !== fromId);
    // Dropping onto a later card places the dragged card after it; onto an earlier card, before it.
    ids.splice(ids.indexOf(toId) + (movingForward ? 1 : 0), 0, fromId);
    setOrder(ids);
    try {
      localStorage.setItem(`lendloop:order:${storageKey}`, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  }

  const cardProps = (id: string) => ({
    ref: (el: HTMLLIElement | null) => {
      if (el) els.current.set(id, el);
      else els.current.delete(id);
    },
    draggable: armed === id,
    className: `${dragging === id ? "dragging" : ""} ${over === id && dragging !== id ? "over" : ""}`.trim(),
    onDragStart: (e: React.DragEvent) => {
      setDragging(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (over !== id) setOver(id);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragging) move(dragging, id);
      setDragging(null);
      setOver(null);
      setArmed(null);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
      setArmed(null);
    },
  });

  const handleProps = (id: string) => ({
    className: "handle",
    title: "Drag to reorder",
    "aria-label": "Drag to reorder",
    onMouseDown: () => setArmed(id),
    onMouseUp: () => setArmed(null),
  });

  return { ordered, cardProps, handleProps };
}

/** Animations follow the OS "reduce motion" setting unless the user switches them on explicitly. */
export function MotionToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("lendloop:motion");
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setOn(saved ? saved === "on" : !reduce);
    } catch {
      setOn(true);
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = on ? "on" : "off";
  }, [on]);
  return (
    <label className="motion">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          try {
            localStorage.setItem("lendloop:motion", e.target.checked ? "on" : "off");
          } catch {
            /* ignore */
          }
        }}
      />
      Animations
    </label>
  );
}
