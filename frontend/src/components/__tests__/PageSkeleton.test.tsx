import { render, screen } from "@testing-library/react";
import PageSkeleton from "../PageSkeleton";

describe("PageSkeleton", () => {
  it("renders title and requested skeleton cards", () => {
    const { container } = render(<PageSkeleton title="Loading cases" cards={4} lines={2} />);

    expect(screen.getByText("Loading cases")).toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton-card-grid .card")).toHaveLength(4);
  });

  it("renders fallback title when title is missing", () => {
    render(<PageSkeleton />);
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });
});
