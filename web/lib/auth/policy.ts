export const SESSION_COOKIE = "trendcraft-session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export function safeReturnPath(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n]/.test(value) ||
    value.startsWith("/login") ||
    value.startsWith("/api/")
  )
    return "/";
  return value;
}
export function credentials(input: Record<string, unknown>) {
  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  const password = typeof input.password === "string" ? input.password : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter a valid email address.");
  if (password.length < 12 || password.length > 128)
    throw new Error("Use a password between 12 and 128 characters.");
  return { email, password };
}
export function brandDetails(input: Record<string, unknown>) {
  const name = String(input.brandName || "").trim();
  if (name.length < 2 || name.length > 80)
    throw new Error("Enter a brand name between 2 and 80 characters.");
  let url;
  try {
    const value = String(input.website || "").trim();
    url = new URL(value.includes("://") ? value : "https://" + value);
  } catch {
    throw new Error("Enter your brand website.");
  }
  const domain = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain) ||
    /\.(local|internal|test|localhost)$/.test(domain)
  )
    throw new Error("Enter a public brand website.");
  return { name, domain };
}
export function sameOrigin(request: Request) {
  return (
    request.headers.get("origin") === new URL(request.url).origin &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}
