"use client";

type PageSkeletonProps = {
  title?: string;
  cards?: number;
  lines?: number;
};

export default function PageSkeleton({
  title = "Loading",
  cards = 3,
  lines = 3,
}: PageSkeletonProps) {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="pill">{title}</div>
        <div className="skeleton-line skeleton-title" style={{ marginTop: 12 }} />
        <div className="skeleton-line" style={{ width: "72%" }} />
      </div>
      <div className="skeleton-card-grid">
        {Array.from({ length: cards }).map((_, cardIndex) => (
          <div key={`skeleton-card-${cardIndex}`} className="card">
            {Array.from({ length: lines }).map((__, lineIndex) => (
              <div
                key={`skeleton-line-${cardIndex}-${lineIndex}`}
                className="skeleton-line"
                style={{ width: lineIndex === lines - 1 ? "45%" : lineIndex === 0 ? "58%" : "88%" }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

