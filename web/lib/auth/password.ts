import { randomBytes, scrypt as callback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(callback);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return "scrypt:" + salt + ":" + digest.toString("hex");
}
export async function verifyPassword(password: string, stored: string) {
  const [version, salt, hash] = stored.split(":");
  if (
    version !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(hash || "")
  )
    return false;
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(digest, Buffer.from(hash, "hex"));
}
