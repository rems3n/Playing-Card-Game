"use client";

import type { ReactNode } from "react";

/** Native radios provide arrow-key navigation and one selected value. */
export function ChoiceGroup<T extends string | number>({ name, label, value, options, onChange, className = "" }: {
  name: string;
  label: string;
  value: T | null;
  options: { value: T; label: string; content?: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return <div className={`choice-group ${className}`} role="radiogroup" aria-label={label}>
    {options.map(option => <label key={option.value} className={`choice-option ${value === option.value ? "selected" : ""} ${option.disabled ? "unavailable" : ""}`} title={option.title}>
      <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={option.disabled}
        aria-label={option.label} onChange={() => onChange(option.value)} />
      <span className="choice-content">{option.content ?? option.label}</span>
    </label>)}
  </div>;
}
