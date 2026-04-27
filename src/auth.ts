import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { UserRole, UserStatus } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

async function getPrimaryMembership(userId: string) {
  return prisma.tenantMembership.findFirst({
    where: {
      userId,
    },
    include: {
      tenant: true,
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

function resolveUserRole(role: unknown) {
  return typeof role === "string" && Object.values(UserRole).includes(role as UserRole)
    ? (role as UserRole)
    : UserRole.OWNER;
}

function resolveUserStatus(status: unknown) {
  return typeof status === "string" && Object.values(UserStatus).includes(status as UserStatus)
    ? (status as UserStatus)
    : UserStatus.ACTIVE;
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  callbacks: {
    authorized({ auth: session }) {
      return Boolean(session?.user);
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
        token.role = user.role ?? UserRole.OWNER;
        token.status = user.status ?? UserStatus.ACTIVE;
        token.tenantId = user.tenantId ?? null;
        token.tenantName = user.tenantName ?? null;
        return token;
      }

      if (!token.sub || token.role) {
        return token;
      }

      const dbUser = await prisma.user.findUnique({
        where: {
          id: token.sub,
        },
      });

      if (!dbUser) {
        return token;
      }

      const membership = await getPrimaryMembership(dbUser.id);

      token.email = dbUser.email;
      token.name = dbUser.name;
      token.role = membership?.role ?? UserRole.OWNER;
      token.status = dbUser.status ?? UserStatus.ACTIVE;
      token.tenantId = membership?.tenantId ?? null;
      token.tenantName = membership?.tenant.name ?? null;

      return token;
    },
    async session({ session, token }) {
      if (!session.user) {
        return session;
      }

      session.user.email =
        typeof token.email === "string" ? token.email : (session.user.email ?? undefined);
      session.user.id = token.sub ?? "";
      session.user.name = typeof token.name === "string" ? token.name : session.user.name;
      session.user.role = resolveUserRole(token.role);
      session.user.status = resolveUserStatus(token.status);
      session.user.tenantId = typeof token.tenantId === "string" ? token.tenantId : null;
      session.user.tenantName = typeof token.tenantName === "string" ? token.tenantName : null;

      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: {
            email: parsed.data.email.toLowerCase(),
          },
        });

        if (!user || user.status !== UserStatus.ACTIVE) {
          return null;
        }

        const isValid = await compare(parsed.data.password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        const membership = await getPrimaryMembership(user.id);

        await prisma.user.update({
          where: {
            id: user.id,
          },
          data: {
            lastLoginAt: new Date(),
          },
        });

        return {
          email: user.email,
          id: user.id,
          name: user.name,
          role: membership?.role ?? UserRole.OWNER,
          status: user.status,
          tenantId: membership?.tenantId ?? null,
          tenantName: membership?.tenant.name ?? null,
        };
      },
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  trustHost: true,
});
