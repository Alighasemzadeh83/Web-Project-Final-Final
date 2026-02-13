"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/useAuth";
import { hasAnyRole } from "../lib/roles";
import PageSkeleton from "./PageSkeleton";

type RoleGateProps = {
  roles: string[];
  redirect?: string;
  children: React.ReactNode;
};

export default function RoleGate({ roles, redirect = "/dashboard", children }: RoleGateProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  const isAdmin = !!user?.is_superuser || hasAnyRole(user, ["Administrator"]);
  const allowed = !loading && !!user && (isAdmin || hasAnyRole(user, roles));

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/auth");
      return;
    }
    if (!user.is_superuser && !hasAnyRole(user, ["Administrator"]) && !hasAnyRole(user, roles)) {
      router.replace(redirect);
    }
  }, [loading, user, roles, redirect, router]);

  if (loading) return <PageSkeleton title="Checking access" cards={2} lines={2} />;
  if (!allowed) return null;
  return <>{children}</>;
}
