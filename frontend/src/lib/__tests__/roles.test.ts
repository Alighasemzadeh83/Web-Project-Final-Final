import { hasAnyRole, hasRole, roleNames } from "../roles";

describe("roles helpers", () => {
  it("includes both role name and visibility role", () => {
    const names = roleNames({
      roles: [{ id: 1, name: "Ghasy", visibility_role: "Judge" }],
    });

    expect(names).toContain("ghasy");
    expect(names).toContain("judge");
  });

  it("checks role membership case-insensitively", () => {
    const user = { roles: [{ id: 1, name: "Detective" }] };
    expect(hasRole(user, ["detective"])).toBe(true);
    expect(hasAnyRole(user, ["DETECTIVE"])).toBe(true);
  });

  it("returns false when user has no roles", () => {
    expect(hasRole(null, ["Judge"])).toBe(false);
    expect(hasAnyRole({ roles: [] }, ["Judge"])).toBe(false);
  });
});
