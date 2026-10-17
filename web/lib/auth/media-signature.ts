import { createHmac, timingSafeEqual } from "node:crypto";
function signature(path: string, expires: string) {
  return createHmac("sha256", process.env.AUTH_WORKER_TOKEN || "")
    .update(path + "\n" + expires)
    .digest("hex");
}
export function signedMediaPath(path: string) {
  if (!process.env.AUTH_WORKER_TOKEN)
    throw new Error("Media sharing is not configured.");
  const expires = String(Math.floor(Date.now() / 1000) + 7 * 86400);
  return (
    path + "?expires=" + expires + "&signature=" + signature(path, expires)
  );
}
export function validMediaSignature(url: URL) {
  const expires = url.searchParams.get("expires") || "",
    sig = url.searchParams.get("signature") || "";
  if (
    !process.env.AUTH_WORKER_TOKEN ||
    !/^\d{10}$/.test(expires) ||
    !/^[a-f0-9]{64}$/.test(sig) ||
    Number(expires) < Date.now() / 1000 ||
    Number(expires) > Date.now() / 1000 + 8 * 86400
  )
    return false;
  return timingSafeEqual(
    Buffer.from(sig, "hex"),
    Buffer.from(signature(url.pathname, expires), "hex"),
  );
}
