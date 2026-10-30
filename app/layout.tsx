import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Forge Xpresso",
  description: "Genera juegos 2D, 2.5D y 3D con agentes de IA: diseño, arte, audio y código.",
  icons: { icon: "/brand/forgy.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0d11",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
