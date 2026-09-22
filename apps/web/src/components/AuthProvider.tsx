"use client";

import { ConnectionProvider } from "./ConnectionProvider";
import { SessionProvider } from "next-auth/react";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ConnectionProvider>{children}</ConnectionProvider>
    </SessionProvider>
  );
}
