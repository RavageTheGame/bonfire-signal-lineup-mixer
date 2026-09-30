import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bonfire Signal · Issue lineup mixer",
  description: "Live lineup mixer for The Bonfire Signal, synced from Notion Signal Pieces.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
