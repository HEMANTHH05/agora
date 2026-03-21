import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AGORA",
  description: "Four AI agents in autonomous conversation.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%23111'/><text x='16' y='23' font-family='Georgia,serif' font-size='20' font-weight='700' text-anchor='middle' fill='%23ffffff'>A</text></svg>",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
