import { currentSession } from "@/lib/auth/session";

// Kept as a compatibility name for existing callers; brand context now comes
// exclusively from a verified session, never a global single-brand cache.
export async function getOrCreateCurrentBrand() {
  const session = await currentSession();
  if (!session) throw new Error("Sign in to access your brand workspace.");
  return session.brand;
}
