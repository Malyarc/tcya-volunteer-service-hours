import { useEffect } from "react";

interface Props {
  message: string | null;
  onDismiss: () => void;
}

export function Toast({ message, onDismiss }: Props) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-slate-900/90 px-5 py-2.5 text-sm font-medium text-white shadow-xl ring-1 ring-white/10 backdrop-blur">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 text-brand-300"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        {message}
      </div>
    </div>
  );
}
