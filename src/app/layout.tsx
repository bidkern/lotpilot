import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import { ThemeToggle } from "@/components/theme-toggle";

import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "LotPilot",
  description:
    "Multi-tenant dealer operations platform for inventory onboarding, sync automation, exports, and messaging workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                try {
                  const stored = window.localStorage.getItem("lotpilot-theme");
                  const mode = stored === "dark" || stored === "light"
                    ? stored
                    : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
                  document.documentElement.dataset.theme = mode;
                } catch {}
              })();
            `,
          }}
        />
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
