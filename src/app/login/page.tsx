"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Incorrect password");
      router.push(next);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Incorrect password");
    }
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-8 bg-gradient-to-b from-sky-100 via-sky-50 to-amber-50 px-6 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-950">
      <div className="flex flex-col items-center gap-3">
        <Image src="/icon.svg" alt="" width={76} height={76} priority className="drop-shadow-md" />
        <div className="text-center">
          <h1 className="text-xl font-bold">Card Portfolio</h1>
          <p className="text-sm text-neutral-500">Track your Pokémon card collection</p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-xs flex-col gap-3 rounded-3xl border border-sky-100 bg-white p-6 shadow-lg shadow-sky-900/5 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none"
      >
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:ring-sky-950"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !password}
          className="rounded-full bg-sky-600 px-4 py-2.5 font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
