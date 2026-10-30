import type { Metadata } from "next";
import "../forge.css";
import "../forge-extra.css";

export const metadata: Metadata = {
  title: "Forge Xpresso · Estudio",
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
