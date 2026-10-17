"use client";
import { createContext, useContext } from "react";
export interface BrandSession {
  email: string;
  role: "owner" | "brand";
  brand: { id: string; name: string; domain: string };
}
const Context = createContext<BrandSession | null>(null);
export function BrandSessionProvider({
  value,
  children,
}: {
  value: BrandSession;
  children: React.ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useBrandSession() {
  return useContext(Context);
}
export function useBrand() {
  return useBrandSession()?.brand || { id: "", name: "Your brand", domain: "" };
}
