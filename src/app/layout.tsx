import "~/styles/globals.css";

import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";

import { auth } from "~/server/auth";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: "Huddle",
  description: "A shared workspace where a team runs, steers and reviews agent tasks together.",
};

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  return (
    <html lang="en" className={geist.variable}>
      <body>
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="font-semibold tracking-tight">
              Huddle
            </Link>
            {session ? (
              <div className="flex items-center gap-3 text-sm text-stone-600">
                <span>{session.user.name}</span>
                <Link href="/api/auth/signout" className="hover:text-stone-900">
                  Sign out
                </Link>
              </div>
            ) : null}
          </div>
        </header>
        <TRPCReactProvider>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
