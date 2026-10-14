import { useEffect, useRef } from "react";

function Labubu() {
  return (
    <svg className="labubu" viewBox="0 0 200 270" role="img" aria-label="A purple Labubu dancing in a SMALL MONSTER. BIG SERVICE. T-shirt">
      <g className="labubu-body">
        {/* ears */}
        <g className="labubu-ear left">
          <ellipse cx="70" cy="48" rx="15" ry="40" transform="rotate(-14 70 48)" fill="#7c3aed" />
          <ellipse cx="70" cy="52" rx="7" ry="28" transform="rotate(-14 70 52)" fill="#f9a8d4" />
        </g>
        <g className="labubu-ear right">
          <ellipse cx="130" cy="48" rx="15" ry="40" transform="rotate(14 130 48)" fill="#7c3aed" />
          <ellipse cx="130" cy="52" rx="7" ry="28" transform="rotate(14 130 52)" fill="#f9a8d4" />
        </g>
        {/* head + face patch */}
        <circle cx="100" cy="105" r="52" fill="#7c3aed" />
        <ellipse cx="100" cy="114" rx="38" ry="32" fill="#ede9fe" />
        {/* eyes */}
        <ellipse cx="84" cy="104" rx="8" ry="10" fill="#111" />
        <ellipse cx="116" cy="104" rx="8" ry="10" fill="#111" />
        <circle cx="86" cy="100" r="3" fill="#fff" />
        <circle cx="118" cy="100" r="3" fill="#fff" />
        {/* toothy grin */}
        <path d="M74 122 Q100 146 126 122 Q100 132 74 122 Z" fill="#3b0764" />
        <path
          d="M78 123 l3 6 l3 -5 l3 6 l3 -5 l3 6 l3 -5 l3 6 l3 -5 l3 6 l3 -5 l3 6 l3 -5 l3 6 l3 -5 l3 5"
          fill="#fff"
          stroke="#fff"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        {/* arms */}
        <g className="labubu-arm left">
          <ellipse cx="52" cy="182" rx="11" ry="26" transform="rotate(35 52 182)" fill="#7c3aed" />
        </g>
        <g className="labubu-arm right">
          <ellipse cx="148" cy="182" rx="11" ry="26" transform="rotate(-35 148 182)" fill="#7c3aed" />
        </g>
        {/* legs */}
        <ellipse cx="82" cy="250" rx="14" ry="12" fill="#6d28d9" />
        <ellipse cx="118" cy="250" rx="14" ry="12" fill="#6d28d9" />
        {/* T-shirt */}
        <path d="M58 160 L80 150 L120 150 L142 160 L150 182 L136 186 L134 240 L66 240 L64 186 L50 182 Z" fill="#39ff14" stroke="#0a0a0a" strokeWidth="2" />
        <text x="100" y="192" textAnchor="middle" className="labubu-shirt-text">SMALL</text>
        <text x="100" y="204" textAnchor="middle" className="labubu-shirt-text">MONSTER.</text>
        <text x="100" y="220" textAnchor="middle" className="labubu-shirt-text">BIG</text>
        <text x="100" y="232" textAnchor="middle" className="labubu-shirt-text">SERVICE.</text>
      </g>
    </svg>
  );
}

export function Celebration({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="celebration-backdrop" onClick={onClose}>
      <div
        className="celebration"
        role="dialog"
        aria-modal="true"
        aria-labelledby="celebration-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 0.25}s` }} />
          ))}
        </div>
        <h2 id="celebration-title" className="celebration-title">
          ALL TICKETS CLEARED!
        </h2>
        <Labubu />
        <p className="celebration-sub">3/3 resolved · every payment human-approved · no drafts sent</p>
        <button ref={closeRef} className="btn btn-start" onClick={onClose}>
          ★ CONTINUE ★
        </button>
      </div>
    </div>
  );
}
