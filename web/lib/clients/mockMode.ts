/** Defaults to true on purpose — see phase1_phase2_build_tasklist.md: real
 * API calls should be opt-in (explicit fixture capture, pre-demo smoke
 * test), never the accidental default while iterating on UI/logic. */
export function isMockMode(): boolean {
  return process.env.MOCK_MODE !== "false";
}
