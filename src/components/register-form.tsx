"use client";

import Link from "next/link";
import { LoaderCircle, Mail, Store, UserRound, Globe, LockKeyhole } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type RegisterFormProps = {
  errorMessage?: string | null;
};

export function RegisterForm({ errorMessage }: RegisterFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [localError, setLocalError] = useState<string | null>(errorMessage ?? null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/register", {
          body: JSON.stringify({
            email,
            name,
            password,
            tenantName,
            websiteUrl: websiteUrl.trim() || undefined,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to create your workspace.");
        }

        const signInResult = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (signInResult?.error) {
          throw new Error("Workspace created, but automatic sign-in failed.");
        }

        router.push("/onboarding");
        router.refresh();
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : "Unable to create your workspace.");
      }
    });
  }

  return (
    <section className="rounded-[32px] border border-[var(--line)] bg-[var(--panel-strong)] p-8 shadow-[0_24px_80px_rgba(18,31,37,0.12)] sm:p-10">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.32em] text-[var(--muted)]">
          The Book
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
          Start your dealer inventory workspace
        </h2>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
          Create the first tenant owner account, then connect the dealership site in the onboarding
          wizard.
        </p>
      </div>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Your name
          </span>
          <span className="flex items-center gap-3 rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
            <UserRound className="h-4 w-4 text-[var(--muted)]" />
            <input
              className="w-full bg-transparent text-sm outline-none"
              onChange={(event) => setName(event.target.value)}
              placeholder="Adele Manager"
              required
              type="text"
              value={name}
            />
          </span>
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Work email
          </span>
          <span className="flex items-center gap-3 rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
            <Mail className="h-4 w-4 text-[var(--muted)]" />
            <input
              autoComplete="email"
              className="w-full bg-transparent text-sm outline-none"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@dealer.com"
              required
              type="email"
              value={email}
            />
          </span>
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Password
          </span>
          <span className="flex items-center gap-3 rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
            <LockKeyhole className="h-4 w-4 text-[var(--muted)]" />
            <input
              autoComplete="new-password"
              className="w-full bg-transparent text-sm outline-none"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimum 8 characters"
              required
              type="password"
              value={password}
            />
          </span>
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Dealership name
          </span>
          <span className="flex items-center gap-3 rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
            <Store className="h-4 w-4 text-[var(--muted)]" />
            <input
              className="w-full bg-transparent text-sm outline-none"
              onChange={(event) => setTenantName(event.target.value)}
              placeholder="Forest City Chrysler"
              required
              type="text"
              value={tenantName}
            />
          </span>
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Dealership website
          </span>
          <span className="flex items-center gap-3 rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
            <Globe className="h-4 w-4 text-[var(--muted)]" />
            <input
              className="w-full bg-transparent text-sm outline-none"
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://www.exampledealer.com"
              type="url"
              value={websiteUrl}
            />
          </span>
        </label>

        {localError ? (
          <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {localError}
          </div>
        ) : null}

        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          Create workspace
        </button>
      </form>

      <p className="mt-6 text-sm text-[var(--muted)]">
        Already have an account?{" "}
        <Link className="font-semibold text-[var(--accent-strong)]" href="/login">
          Sign in
        </Link>
      </p>
    </section>
  );
}
