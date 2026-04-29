"use client";

import Link from "next/link";
import { LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type LoginFormProps = {
  callbackUrl?: string | null;
  errorMessage?: string | null;
};

export function LoginForm({ callbackUrl, errorMessage }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(errorMessage ?? null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    startTransition(async () => {
      const result = await signIn("credentials", {
        callbackUrl: callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : undefined,
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setLocalError("The email or password did not match an active admin account.");
        return;
      }

      router.push(result?.url || callbackUrl || "/admin");
      router.refresh();
    });
  }

  return (
    <section className="rounded-[36px] border border-[var(--line)] bg-[rgba(250,251,247,0.92)] p-8 shadow-[0_24px_80px_rgba(18,31,37,0.12)] sm:p-10">
      <div className="max-w-sm">
        <p className="font-mono text-xs uppercase tracking-[0.32em] text-[var(--muted)]">
          Secure Login
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
          Sign in to your workspace
        </h2>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
          Sign in with your tenant-scoped account to manage onboarding, inventory, listing, and
          messaging workflows.
        </p>
      </div>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
            Email
          </span>
          <span className="flex items-center gap-3 rounded-[20px] border border-[var(--line)] bg-white px-4 py-3">
            <Mail className="h-4 w-4 text-[var(--muted)]" />
            <input
              autoComplete="email"
              className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@lotpilot.local"
              type="email"
              value={email}
            />
          </span>
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
            Password
          </span>
          <span className="flex items-center gap-3 rounded-[20px] border border-[var(--line)] bg-white px-4 py-3">
            <LockKeyhole className="h-4 w-4 text-[var(--muted)]" />
            <input
              autoComplete="current-password"
              className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              type="password"
              value={password}
            />
          </span>
        </label>

        {localError ? (
          <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {localError}
          </div>
        ) : null}

        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-65"
          disabled={isPending}
          type="submit"
        >
          {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          Sign in
        </button>
      </form>

      <div className="mt-8 rounded-[24px] border border-[var(--line)] bg-[rgba(238,244,235,0.78)] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
          First-time setup
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Use <code>npm run seed:admin</code> for a local demo owner account, or{" "}
          <Link className="font-semibold text-[var(--accent-strong)]" href="/register">
            create a workspace here
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
