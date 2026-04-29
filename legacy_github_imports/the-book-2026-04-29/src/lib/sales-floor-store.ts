"use client";

import { useSyncExternalStore } from "react";

import {
  DEFAULT_SALES_TENANT_ID,
  autonomousSalesmanState,
  type SalesFloorState,
} from "@/lib/autonomous-salesman";
import type { SalesActorRole, SalesDealAction } from "@/lib/types";

interface SalesFloorApiResponse {
  ok: boolean;
  salesFloor: SalesFloorState;
  error?: string;
}

export interface SalesFloorActionInput {
  action: SalesDealAction;
  actorName: string;
  actorRole: SalesActorRole;
  nextAction?: string;
  appointmentWindow?: string;
  managerHandoffReason?: string;
  paymentQuote?: string;
  lenderSummary?: string;
  lostReason?: string;
}

export interface SalesFloorNoteInput {
  actorName: string;
  actorRole: SalesActorRole;
  body: string;
}

let salesFloorState: SalesFloorState = autonomousSalesmanState;
let salesFloorLoaded = false;
let salesFloorRequest: Promise<SalesFloorState> | null = null;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setSalesFloorState(nextState: SalesFloorState) {
  salesFloorState = nextState;
  salesFloorLoaded = true;
  emit();
}

async function parseSalesFloorResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | SalesFloorApiResponse
    | { error?: string; message?: string }
    | null;

  if (!response.ok || !payload || !("salesFloor" in payload)) {
    const message =
      payload && "message" in payload ? payload.message : undefined;

    throw new Error(
      payload?.error ||
        message ||
        "Sales floor request failed. Refresh and try again.",
    );
  }

  return payload.salesFloor;
}

async function salesFloorRequestJson(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const salesFloor = await parseSalesFloorResponse(response);
  setSalesFloorState(salesFloor);
  return salesFloor;
}

export async function refreshSalesFloor(tenantId = DEFAULT_SALES_TENANT_ID) {
  return salesFloorRequestJson(`/api/tenants/${tenantId}/sales-floor`, {
    method: "GET",
  });
}

function ensureSalesFloorLoaded() {
  if (typeof window === "undefined" || salesFloorLoaded || salesFloorRequest) {
    return;
  }

  salesFloorRequest = refreshSalesFloor().finally(() => {
    salesFloorRequest = null;
  });
}

export function getSalesFloorSnapshot() {
  ensureSalesFloorLoaded();
  return salesFloorState;
}

export function subscribeToSalesFloor(listener: () => void) {
  ensureSalesFloorLoaded();
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useSalesFloor() {
  return useSyncExternalStore(
    subscribeToSalesFloor,
    getSalesFloorSnapshot,
    () => autonomousSalesmanState,
  );
}

export async function runSalesDealAction(
  dealId: string,
  input: SalesFloorActionInput,
  tenantId = DEFAULT_SALES_TENANT_ID,
) {
  return salesFloorRequestJson(`/api/tenants/${tenantId}/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function addSalesDealNote(
  dealId: string,
  input: SalesFloorNoteInput,
  tenantId = DEFAULT_SALES_TENANT_ID,
) {
  return salesFloorRequestJson(
    `/api/tenants/${tenantId}/deals/${dealId}/notes`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}
