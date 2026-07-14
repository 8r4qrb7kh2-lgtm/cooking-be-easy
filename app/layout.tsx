import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import Navigation from "@/components/Navigation";
import MainContainer from "@/components/MainContainer";
import RatingPrompt from "@/components/RatingPrompt";

export const metadata: Metadata = {
  title: "Cooking be easy",
  description: "Plan your meals, build your grocery list",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-app">
        <AuthProvider>
          <Navigation />
          <MainContainer>{children}</MainContainer>
          <RatingPrompt />
        </AuthProvider>
      </body>
    </html>
  );
}
