import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope, Space_Grotesk } from "next/font/google";

import { ThemeProvider } from "@/components/providers/theme-provider";
import { AppShell } from "@/components/shell/app-shell";

import "./globals.css";

const bodyFont = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

const displayFont = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Autonomous Car Salesman",
  description:
    "Interactive autonomous dealership sales floor with buyer simulation, follow-up automation, appointments, and manager handoff testing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
