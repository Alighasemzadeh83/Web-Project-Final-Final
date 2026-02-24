import { getApiErrorMessage } from "../api";

describe("getApiErrorMessage", () => {
  it("returns fallback for empty error", () => {
    expect(getApiErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("reads DRF detail error", () => {
    const error = { response: { data: { detail: "Invalid token." } } };
    expect(getApiErrorMessage(error)).toBe("Invalid token.");
  });

  it("formats field-level errors", () => {
    const error = {
      response: {
        data: {
          username: ["This username is already taken."],
          national_id: ["This national ID is already taken."],
        },
      },
    };
    expect(getApiErrorMessage(error)).toBe(
      "username: This username is already taken. | national_id: This national ID is already taken."
    );
  });

  it("formats non_field_errors without prefix", () => {
    const error = {
      response: {
        data: {
          non_field_errors: ["Unable to login with provided credentials."],
        },
      },
    };
    expect(getApiErrorMessage(error)).toBe("Unable to login with provided credentials.");
  });
});
