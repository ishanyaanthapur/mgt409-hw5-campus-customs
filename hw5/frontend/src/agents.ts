import type { AgentId } from "./types";

export interface AgentMeta {
  id: AgentId;
  label: string;
  role: string;
  color: string;
  /** 8x8 pixel-art glyph: "#" = lit pixel. */
  icon: string[];
}

export const AGENT_ORDER: AgentId[] = ["boss", "inventory", "accounting", "facilities", "customer_service"];

export const AGENTS: Record<AgentId, AgentMeta> = {
  boss: {
    id: "boss",
    label: "Boss",
    role: "Runs the desk, hands off work",
    color: "#39ff14",
    icon: ["........", "#..##..#", "##.##.##", "########", "#.#..#.#", "########", "########", "........"],
  },
  inventory: {
    id: "inventory",
    label: "Inventory",
    role: "Stock, vendors, discounts",
    color: "#00e5ff",
    icon: ["########", "#......#", "########", "#..##..#", "#..##..#", "#......#", "#......#", "########"],
  },
  accounting: {
    id: "accounting",
    label: "Accounting",
    role: "Proposes payments",
    color: "#ffe14a",
    icon: [".######.", ".#....#.", ".######.", ".#.#.##.", ".######.", ".#.#.##.", ".######.", "........"],
  },
  facilities: {
    id: "facilities",
    label: "Facilities",
    role: "Lease & rent",
    color: "#ff9f1c",
    icon: ["...##...", ".#.##.#.", "..####..", "###..###", "###..###", "..####..", ".#.##.#.", "...##..."],
  },
  customer_service: {
    id: "customer_service",
    label: "Customer Service",
    role: "Drafts replies (never sends)",
    color: "#ff4fd8",
    icon: [".######.", "#......#", "#.#.#.##", "#......#", ".######.", "..##....", ".#......", "........"],
  },
};

export function agentMeta(id: string | null | undefined): AgentMeta | null {
  return id && id in AGENTS ? AGENTS[id as AgentId] : null;
}
