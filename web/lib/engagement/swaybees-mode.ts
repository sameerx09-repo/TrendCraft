export type SwayBeesMode = "test" | "live";
export type TestDelivery = "local" | "swaybees";

export function engagementExecution(mockMode: boolean, delivery: unknown) {
  if (mockMode && delivery === undefined)
    throw new Error(
      "Choose SwayBees test tasks or local simulation before launching.",
    );
  if (delivery !== undefined && delivery !== "local" && delivery !== "swaybees")
    throw new Error("Choose local simulation or SwayBees test delivery.");
  if (!mockMode && delivery !== undefined)
    throw new Error("Test delivery is only available in Test mode.");
  return {
    mode: (mockMode ? "test" : "live") as SwayBeesMode,
    provider: !mockMode || delivery === "swaybees",
  };
}
export function assertSwayBeesMode(received: unknown, expected: SwayBeesMode) {
  if (received !== expected)
    throw new Error(
      "SwayBees did not confirm mode: " +
        expected +
        ". Dispatch stopped. Check SwayBees before retrying.",
    );
}
