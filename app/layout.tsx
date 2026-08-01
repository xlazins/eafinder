import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://eafinder.vercel.app",
  ),
  title: "SettatScope | Business Location Intelligence",
  description:
    "Analyze small-area business fit and follow official company activity over time in Settat, Morocco.",
  openGraph: {
    title: "SettatScope",
    description: "Business evolution and location intelligence for Settat.",
    images: [{ url: "/og.png", width: 1732, height: 910, alt: "SettatScope business evolution timeline" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SettatScope",
    description: "Business evolution and location intelligence for Settat.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          crossOrigin=""
        />
        <Script
          src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
          strategy="beforeInteractive"
          crossOrigin=""
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
