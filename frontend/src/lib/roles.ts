type Role = { id: number; name: string; visibility_role?: string };
type User = { roles?: Role[] };

const normalizeRole = (roleName: string) =>
  roleName
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const roleNames = (user: User | null) => {
  const names = new Set<string>();
  user?.roles?.forEach((role) => {
    names.add(normalizeRole(role.name));
    if (role.visibility_role) {
      names.add(normalizeRole(role.visibility_role));
    }
  });
  return Array.from(names);
};

export const hasRole = (user: User | null, roles: string[]) => {
  if (!user?.roles?.length) return false;
  const names = roleNames(user);
  return roles.some((r) => names.includes(normalizeRole(r)));
};

export const hasAnyRole = (user: User | null, roles: string[]) => hasRole(user, roles);
