import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Standup Generator",
  description: "Generate professional standup summaries from your GitHub and Slack activity",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
