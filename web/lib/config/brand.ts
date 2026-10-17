/** Legacy bootstrap defaults only. Request-time brand context now comes from the verified brand session. */
export const CURRENT_BRAND = {
  name: "GloVibe",
  domain: "glo-vibe.com",
  primaryColor: "#8a5a2e",
  secondaryColor: "#4c6b52",
  fontFamily: "IBM Plex Sans",
  /** Seed default, used only when the brand_profiles row is first created.
   * After that, brand_profiles.hashtags in the DB is the real source of
   * truth (per trendcraft_implementation_plan.md section 8) — edit there,
   * not here, to change what a "Refresh trends" click actually scrapes. */
  hashtags: ["skincareindia", "indianskincare", "ayurveda"],
} as const;
