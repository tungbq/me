"use client";

import { useState } from "react";

export function TagCloud({
  legend,
  options,
  active,
  onToggle,
  defaultVisible = 19,
}: {
  legend: string;
  /** Already sorted by importance (frequency desc) -- see lib/projects.ts's getTopics(). */
  options: string[];
  active: string[];
  onToggle: (value: string) => void;
  defaultVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (options.length === 0) return null;

  // Never hide a topic the user has actively selected, even if it's outside
  // the default-visible set and the cloud is collapsed.
  const visible = expanded
    ? options
    : Array.from(new Set([...options.slice(0, defaultVisible), ...active]));

  const hiddenCount = options.length - visible.length;

  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">{legend}</legend>
      {visible.map((option) => {
        const isActive = active.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isActive}
            onClick={() => onToggle(option)}
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
              isActive
                ? "border-accent bg-accent text-background"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {option}
          </button>
        );
      })}
      {!expanded && hiddenCount > 0 ? (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          className="rounded-full border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:text-foreground"
        >
          +{hiddenCount} more
        </button>
      ) : null}
      {expanded ? (
        <button
          type="button"
          aria-expanded={true}
          onClick={() => setExpanded(false)}
          className="rounded-full border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:text-foreground"
        >
          Show less
        </button>
      ) : null}
    </fieldset>
  );
}
