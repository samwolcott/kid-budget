import { kids } from "../data/demo";
import type { Kid } from "../types";

export async function getKid(slug: string): Promise<Kid | null> {
  return kids[slug] ?? null;
}

export async function getKids(): Promise<Kid[]> {
  return Object.values(kids);
}
