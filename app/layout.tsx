import type { Metadata } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { Bricolage_Grotesque, Geist_Mono } from "next/font/google";
import { fluidInter } from "./fluid-font";
import { auth } from "@/lib/auth";
import SiteNavigation from "./site-navigation";
import { FluidProvider } from "@/lib/fluid-provider";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Pickem",
  description: "Discover polls, answer questions, and follow results.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  let isSignedIn = false;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    isSignedIn = Boolean(session?.user);
  } catch {
    // Navigation must not make public pages unavailable if auth is down.
  }

  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${geistMono.variable} ${fluidInter.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col">
        <FluidProvider>
          <SiteNavigation isSignedIn={isSignedIn} />
          <div className="flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">
            {children}
          </div>
          <Analytics />
        </FluidProvider>
      </body>
    </html>
  );
}
