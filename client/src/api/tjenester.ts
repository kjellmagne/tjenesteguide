import { Tjeneste } from "../types/tjeneste";

const API_BASE = "/api/tjenester";

export async function fetchTjenester(params?: {
  q?: string;
  status?: string;
  tema?: string;
  tjenestetype?: string;
  trinn_niva?: string;
}): Promise<Tjeneste[]> {
  const queryParams = new URLSearchParams();
  if (params?.q) queryParams.append("q", params.q);
  if (params?.status) queryParams.append("status", params.status);
  if (params?.tema) queryParams.append("tema", params.tema);
  if (params?.tjenestetype) queryParams.append("tjenestetype", params.tjenestetype);
  if (params?.trinn_niva) queryParams.append("trinn_niva", params.trinn_niva);

  const url = queryParams.toString()
    ? `${API_BASE}?${queryParams.toString()}`
    : API_BASE;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch tjenester: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchTjenesteById(id: string): Promise<Tjeneste> {
  const response = await fetch(`${API_BASE}/${id}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Tjeneste ikke funnet");
    }
    throw new Error(`Failed to fetch tjeneste: ${response.statusText}`);
  }
  return response.json();
}

export async function createTjeneste(tjeneste: Tjeneste): Promise<Tjeneste> {
  const response = await fetch(API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tjeneste),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `Failed to create tjeneste: ${response.statusText}`);
  }

  return response.json();
}

export async function updateTjeneste(id: string, tjeneste: Tjeneste): Promise<Tjeneste> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tjeneste),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `Failed to update tjeneste: ${response.statusText}`);
  }

  return response.json();
}

export async function deleteTjeneste(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Tjeneste ikke funnet");
    }
    throw new Error(`Failed to delete tjeneste: ${response.statusText}`);
  }
}

