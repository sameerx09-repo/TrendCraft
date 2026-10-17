export async function GET() {
  const base = process.env.SWAYBEES_WEB_URL || process.env.SWAYBEES_API_URL;
  try {
    if (!base) throw new Error("Missing SwayBees URL");
    const url = new URL(base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Invalid SwayBees URL");
    return Response.redirect(new URL("/login", url), 307);
  } catch {
    return Response.json(
      { error: "SwayBees brand login is not configured." },
      { status: 503 },
    );
  }
}
