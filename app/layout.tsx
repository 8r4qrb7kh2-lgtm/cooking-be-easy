import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import Navigation from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Cooking be easy",
  description: "Plan your meals, build your grocery list",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <AuthProvider>
          <Navigation />
          <main className="max-w-4xl mx-auto px-4 py-6 pb-24">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
