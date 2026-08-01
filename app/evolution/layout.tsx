import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Business Evolution | SettatScope",
  description:
    "Explore dated company incorporations, branches, changes and closures reported in Morocco's official BOAL Gazette.",
};

export default function EvolutionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
