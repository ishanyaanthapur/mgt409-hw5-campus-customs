import type { AuditEvent, Cash, DecideResponse, PendingAction, Ticket } from "./types";

export const API_BASE = "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  tickets: () => request<Ticket[]>("/tickets"),
  runTicket: (id: number) => request<{ status: string; ticket_id: number }>(`/tickets/${id}/run`, { method: "POST" }),
  events: (after: number) => request<AuditEvent[]>(`/events?after=${after}&limit=2000`),
  pendingActions: () => request<PendingAction[]>("/pending-actions"),
  decide: (id: number, approved: boolean, approvedBy: string) =>
    request<DecideResponse>(`/pending-actions/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({ approved, approved_by: approvedBy || null }),
    }),
  cash: () => request<Cash>("/cash"),
  reset: () => request<{ status: string }>("/reset", { method: "POST" }),
};
