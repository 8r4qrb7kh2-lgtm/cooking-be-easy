import type { Metadata, Viewport } from "next";
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
  appleWebApp: {
    capable: true,
    title: "Cooking be easy",
    statusBarStyle: "default",
  },
};

// `viewport-fit: cover` lets the page paint edge to edge on an iPhone, which is
// what the native shell in `ios/` wants — the pieces that would otherwise sit
// under the notch or the home indicator pad themselves with env(safe-area-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6faf6",
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
