"use client";

import { useEffect, useId, useRef, useState } from "react";

type Provider = "anthropic" | "openai";

const OPTIONS: { value: Provider; label: string }[] = [
  { value: "anthropic", label: "Claude" },
  { value: "openai", label: "GPT" },
];

interface Props {
  value: Provider;
  onChange: (value: Provider) => void;
  disabled?: boolean;
}

export function ProviderSelect({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedIndex = OPTIONS.findIndex((o) => o.value === value);
  const selectedLabel = OPTIONS[selectedIndex]?.label ?? value;

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (open) setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  function selectOption(index: number) {
    const option = OPTIONS[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) selectOption(activeIndex);
        else setOpen(true);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!open) setOpen(true);
        else setActiveIndex((i) => (i + 1) % OPTIONS.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) setOpen(true);
        else setActiveIndex((i) => (i - 1 + OPTIONS.length) % OPTIONS.length);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  const triggerClass =
    "flex min-w-[7.5rem] items-center justify-between gap-2 rounded-2xl border border-stone-300 bg-[#fffdf7] px-4 py-3 font-mono text-sm text-stone-700 shadow-sm transition-colors hover:border-stone-400 focus-visible:border-pink-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pink-100 disabled:cursor-not-allowed disabled:text-stone-400";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-label="LLM provider"
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        className={triggerClass}
      >
        <span>{selectedLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={`h-3 w-3 shrink-0 text-stone-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="LLM provider"
          className="absolute right-0 z-20 mt-1 min-w-full overflow-hidden rounded-2xl border border-stone-300 bg-[#fffdf7] py-1 shadow-md"
        >
          {OPTIONS.map((option, index) => {
            const isSelected = value === option.value;
            const isActive = activeIndex === index;

            return (
              <li
                key={option.value}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(index)}
                className={`cursor-pointer px-4 py-2.5 font-mono text-sm transition-colors ${
                  isActive ? "bg-pink-50 text-stone-900" : "text-stone-700 hover:bg-stone-50"
                } ${isSelected ? "font-semibold" : ""}`}
              >
                <span className="flex items-center justify-between gap-3">
                  {option.label}
                  {isSelected && (
                    <span aria-hidden="true" className="text-pink-500">
                      ✓
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
