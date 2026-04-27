import type { DefaultSession } from "next-auth";
import type { UserRole, UserStatus } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: UserRole;
      status: UserStatus;
      tenantId: string | null;
      tenantName: string | null;
    };
  }

  interface User {
    role?: UserRole;
    status?: UserStatus;
    tenantId?: string | null;
    tenantName?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    status?: UserStatus;
    tenantId?: string | null;
    tenantName?: string | null;
  }
}
