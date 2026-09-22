"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";
import { useConnection } from "./ConnectionProvider";

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { connected } = useConnection();
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="CardArena home">
        <span className="brand-mark" aria-hidden>
          ♠
        </span>{" "}
        CardArena<span className="brand-note">SEVEN-SIX AND 45s</span>
      </Link>
      <nav aria-label="Main navigation">
        {[
          ["/", "Play"],
          ["/rules", "How to play"],
          ["/history", "My games"],
        ].map(([href, title]) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
          >
            {title}
          </Link>
        ))}
      </nav>
      <div className="header-account">
        <span
          className={`connection-dot ${connected ? "online" : ""}`}
          title={connected ? "Connected" : "Connecting"}
        />
        {session?.user ? (
          <button onClick={() => signOut()}>Sign out</button>
        ) : (
          <button onClick={() => signIn("google")}>Sign in</button>
        )}
      </div>
    </header>
  );
}
