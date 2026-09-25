import type React from "react";

export function IconButton({
  label,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={`ui-iconbtn ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    />
  );
}
