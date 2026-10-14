import type { ReactNode } from "react";

/** Minimal markdown for agent messages: **bold**, "- " bullets, and line breaks. No HTML injection. */
function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyBase}-${i}`}>{part}</span>
    ),
  );
}

export function RichText({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return (
    <div className="rich">
      {lines.map((line, i) => {
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        return bullet ? (
          <div key={i} className="rich-bullet">
            ▸ {inline(bullet[1], String(i))}
          </div>
        ) : (
          <p key={i}>{inline(line, String(i))}</p>
        );
      })}
    </div>
  );
}
