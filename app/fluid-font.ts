import { Inter } from "next/font/google";

// Fluid controls use variable weights locally; the rest of the product keeps
// its existing Bricolage Grotesque and Geist Mono typography.
export const fluidInter = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-fluid-inter",
  display: "swap",
  preload: false,
});
