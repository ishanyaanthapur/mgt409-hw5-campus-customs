import { money } from "../derive";
import type { Cash } from "../types";

const MAX_COINS = 24;
const STACKS = 4;

interface Props {
  cash: Cash | null;
  /** Balance before any payments this run: current balance + every executed payment. */
  startingBalance: number | null;
}

/** A pile of gold coins whose height tracks the balance; the exact figure is always shown beside it. */
function CoinPile({ fraction }: { fraction: number }) {
  const lit = Math.max(0, Math.min(MAX_COINS, Math.ceil(fraction * MAX_COINS)));
  const perStack = MAX_COINS / STACKS;
  return (
    <svg className="coin-pile" viewBox="0 0 120 92" role="img" aria-label={`${lit} of ${MAX_COINS} coins left`}>
      <rect x="2" y="86" width="116" height="4" rx="2" fill="#1d3a12" />
      {Array.from({ length: MAX_COINS }, (_, i) => {
        // Fill stack by stack from the middle outward so the pile looks like a heap.
        const order = [1, 2, 0, 3];
        const stack = order[Math.floor(i / perStack)];
        const level = i % perStack;
        const cx = 18 + stack * 28;
        const cy = 80 - level * 10 - (stack === 1 || stack === 2 ? 0 : -2);
        const gone = i >= lit;
        return (
          <g key={i} className={`coin ${gone ? "gone" : ""}`} style={{ transitionDelay: `${(MAX_COINS - i) * 15}ms` }}>
            <ellipse cx={cx} cy={cy + 3} rx="13" ry="4.5" fill="#a86f00" />
            <ellipse cx={cx} cy={cy} rx="13" ry="4.5" fill="#ffcf33" stroke="#7a4f00" strokeWidth="1" />
            <rect x={cx - 3} y={cy - 1} width="6" height="2" fill="#fff2a8" />
          </g>
        );
      })}
    </svg>
  );
}

export function CashPanel({ cash, startingBalance }: Props) {
  const fraction = cash && startingBalance ? cash.balance / startingBalance : cash ? 1 : 0;
  const paidOut = cash && startingBalance !== null ? startingBalance - cash.balance : null;
  return (
    <section className="panel cash-panel" aria-label="Checking balance">
      <h2 className="panel-title">CHECKING</h2>
      <div className="cash-row">
        <CoinPile fraction={fraction} />
        <div className="cash-figures">
          <div className="cash-balance" aria-live="polite">
            {cash ? money(cash.balance) : "…"}
          </div>
          <div className="dim">as of shop date {cash?.date ?? "—"}</div>
          {paidOut !== null && paidOut > 0 && (
            <div className="dim">
              started {money(startingBalance)} · paid out {money(paidOut)}
            </div>
          )}
        </div>
      </div>
      <p className="fine-print">Cash only goes out in this shop — every coin that disappears was a human-approved payment.</p>
    </section>
  );
}
