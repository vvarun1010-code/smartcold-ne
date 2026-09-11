import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Cold Storage — SIH26005",
  description:
    "Solar-Powered Smart Mini Cold Storage System for Fresh Vegetables in NER",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
