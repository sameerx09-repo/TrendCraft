// Read-only analysis: replays the SAME deterministic seeded selection logic
// pickPersona/pickPersonaClip uses, against every real post already in the
// DB, to show which (persona, role, clip) combos actually get picked and
// how often — without needing any new logging/instrumentation, since the
// selection is a pure function of postId (already stored).
import { readFileSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
process.env.MOCK_MODE = "true";

async function main() {
  const { db } = await import("../lib/db/client");
  const { posts, remixedScripts } = await import("../lib/db/schema");
  const { pickPersona, pickPersonaClip } = await import("../lib/render/personaLibrary");
  const { assignBeatRoles } = await import("../lib/render/runwayPromptTemplates");

  const allPosts = await db.select().from(posts);
  const tally: Record<string, number> = {};
  const personaTally: Record<string, number> = {};
  const roleTally: Record<string, number> = {};

  for (const post of allPosts) {
    const [script] = await db.select().from(remixedScripts).where((await import("drizzle-orm")).eq(remixedScripts.id, post.remixedScriptId));
    if (!script) continue;
    const beats: string[] = script.beats ?? [];
    const roles = assignBeatRoles(beats);
    const persona = pickPersona(post.id);
    personaTally[persona.id] = (personaTally[persona.id] ?? 0) + 1;

    roles.forEach((role, i) => {
      if (role === "proof") return; // always the real product photo, not persona-driven
      const picked = pickPersonaClip(persona, role, `${post.id}-${i}`);
      const key = `${persona.id} / ${role} / ${"videoSrc" in picked ? picked.videoSrc : "?"}`;
      tally[key] = (tally[key] ?? 0) + 1;
      roleTally[`${persona.id}/${role}`] = (roleTally[`${persona.id}/${role}`] ?? 0) + 1;
    });
  }

  console.log(`Total posts analyzed: ${allPosts.length}\n`);
  console.log("Persona pick distribution:");
  Object.entries(personaTally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log("\nPer (persona, role) pool size vs. times picked (repetition risk):");
  Object.entries(roleTally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: picked ${v}x`));

  console.log("\nExact clip usage (which specific clip file, how many times):");
  Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}x  ${k}`));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
