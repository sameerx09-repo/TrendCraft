import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/session";
import BrandAccess from "./BrandAccess";
export default async function LoginPage() {
  if (await currentSession()) redirect("/");
  return <BrandAccess />;
}
