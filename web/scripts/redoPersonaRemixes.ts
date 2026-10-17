// Re-renders every already-rendered persona-library post now that meera and
// ananya exist alongside priya in PERSONAS (personaLibrary.ts) — previously
// every one of these posts landed on priya because she was the only entry.
// $0 marginal cost: renderPersonaLibraryRemix is pure local Remotion
// rendering against already-downloaded clips, no Runway/API calls at all.
// Only touches posts whose renderedFileUrl is the persona-library path
// (`-persona.mp4`), never the real-Runway-spend ones (`-runway.mp4`).
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
  const { posts, remixedScripts, brandProfiles } = await import("../lib/db/schema");
  const { pickPersona, pickPersonaClip } = await import("../lib/render/personaLibrary");
  const { assignBeatRoles } = await import("../lib/render/runwayPromptTemplates");
  const { renderPersonaLibraryRemix } = await import("../lib/render/renderRunwayMultiClip");
  const { put } = await import("../lib/storage");
  const { eq, like } = await import("drizzle-orm");

  const targets = await db.select().from(posts).where(like(posts.renderedFileUrl, "%-persona.mp4"));
  console.log(`${targets.length} persona-library posts to redo\n`);

  for (const post of targets) {
    const [script] = await db.select().from(remixedScripts).where(eq(remixedScripts.id, post.remixedScriptId));
    const [brand] = post.brandProfileId
      ? await db.select().from(brandProfiles).where(eq(brandProfiles.id, post.brandProfileId))
      : [undefined];

    const beats: string[] = script.beats ?? [];
    const roles = assignBeatRoles(beats);
    const persona = pickPersona(post.id);
    const clips = roles.map((role, i) => {
      const picked = pickPersonaClip(persona, role, `${post.id}-${i}`);
      return { ...picked, caption: beats[i] };
    });

    const buffer = await renderPersonaLibraryRemix({ brandName: brand?.name ?? "", clips });
    const url = await put("rendered-posts", `${post.id}-persona.mp4`, buffer);

    await db
      .update(posts)
      .set({ renderedFileUrl: url, renderedAt: new Date(), updatedAt: new Date() })
      .where(eq(posts.id, post.id));

    console.log(`  ${post.id} -> persona: ${persona.id} (${buffer.length.toLocaleString()} bytes)`);
  }

  console.log("\ndone.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
