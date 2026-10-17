import { currentSession } from "@/lib/auth/session";
import { BrandSessionProvider } from "./BrandSession";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./design-system.css";

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

import { Sidebar } from "./Sidebar";

export const metadata: Metadata = {
  title: "trendCraft.ai",
  description: "AI content remix platform for Indian D2C brands",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await currentSession();
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        {session ? (
          <BrandSessionProvider
            value={{
              email: session.email,
              role: session.role,
              brand: {
                id: session.brand.id,
                name: session.brand.name,
                domain: session.brand.domain,
              },
            }}
          >
            <div className="app-shell">
              <Sidebar />
              <main className="app-main">{children}</main>
            </div>
          </BrandSessionProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
