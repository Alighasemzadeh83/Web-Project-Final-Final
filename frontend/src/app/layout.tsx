import "../styles/globals.css";
import type { Metadata } from "next";
import ClientShell from "./ClientShell";

export const metadata: Metadata = {
  title: "Police Case Management",
  description: "Web app for police case workflow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
