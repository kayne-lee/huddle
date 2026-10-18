import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import type { DefaultSession, NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { z } from "zod";

import { env } from "~/env";
import { db } from "~/server/db";
import { accounts, sessions, users, verificationTokens } from "~/server/db/schema";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: { id: string } & DefaultSession["user"];
  }
}

const providers: Provider[] = [];

if (env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET) {
  providers.push(GitHub({ clientId: env.AUTH_GITHUB_ID, clientSecret: env.AUTH_GITHUB_SECRET }));
}

// Lets you sign in as any name locally, so two browser profiles can act as two teammates.
if (env.NODE_ENV !== "production") {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { name: { label: "Name", type: "text", placeholder: "alice" } },
      async authorize(credentials) {
        const parsed = z.object({ name: z.string().trim().min(1).max(64) }).safeParse(credentials);
        if (!parsed.success) return null;
        const { name } = parsed.data;
        const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@dev.huddle`;
        const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
        if (existing) return existing;
        const [created] = await db.insert(users).values({ name, email }).returning();
        return created ?? null;
      },
    }),
  );
}

export const authConfig = {
  providers,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // The credentials provider only works with JWT sessions.
  session: { strategy: "jwt" },
  callbacks: {
    session: ({ session, token }) => ({
      ...session,
      user: { ...session.user, id: token.sub ?? "" },
    }),
  },
} satisfies NextAuthConfig;
