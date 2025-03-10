import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Using Inter for both sans and mono fonts, but preserving the variable names
const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Using Inter again but with a different variable name to replace Geist_Mono
const geistMono = Inter({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tejavath's Assistant",
  description: "Developed by The Tejavath",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}